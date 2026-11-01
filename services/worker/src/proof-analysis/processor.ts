import { createHash } from "node:crypto"
import type { PrismaClient } from "@leadshelf/prisma-client"
import { Prisma } from "@leadshelf/prisma-client"
import {
  VISION_PROTOCOL_VERSION,
  type VisionReferenceSlot,
  type VisionScanRequest,
} from "@leadshelf/api-contracts/vision/v1"
import {
  compareShelf,
  SHELF_COMPARISON_VERSION,
  selectProofVideoFrameTimestamps,
  type ShelfExpectedPlacement,
} from "@leadshelf/core"
import {
  consumeDurableRateLimit,
  finishShelfAnalysisRun,
  persistShelfMetricSnapshot,
  startShelfAnalysisRun,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimitRow,
} from "@leadshelf/db"
import {
  analyzeSelectedProofFrames,
  configuredProofAnalysisIdentity,
  type ProofAnalysisIdentity,
  type ProofFrameAnalysisResult,
} from "./analyzer"
import {
  FfmpegProofFrameExtractor,
  proofFrameKey,
  type ExtractedProofFrame,
  type ProofFrameExtractor,
} from "./frame-extractor"
import { getObjectBuffer, putObjectBuffer } from "../storage/s3"

type JsonRecord = Record<string, unknown>

export interface ProofAnalysisStorage {
  getObjectBuffer(key: string): Promise<{ body: Buffer; contentType: string } | null>
  putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void>
}

export interface ProcessProofVideoAnalysisDeps {
  storage?: ProofAnalysisStorage
  extractor?: ProofFrameExtractor
  analyze?: typeof analyzeSelectedProofFrames
  analysisIdentity?: ProofAnalysisIdentity
  now?: () => Date
  organizationId?: string
  consumeAiBudget?: (
    prisma: PrismaClient,
    organizationId: string,
    now: Date,
  ) => Promise<RateLimitResult>
}

export type ProcessProofVideoAnalysisResult =
  | { status: "empty" }
  | { status: "completed"; photoSubmissionId: string; reviewId: string; provider: string; modelVersion: string }
  | { status: "skipped"; photoSubmissionId: string; reason: string }
  | { status: "failed"; photoSubmissionId: string; error: string }

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function asJsonObject(value: unknown): Prisma.JsonObject {
  return asRecord(value) as Prisma.JsonObject
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1000)
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function proofAiRateLimitRule(env: NodeJS.ProcessEnv = process.env): RateLimitRule {
  return {
    max: boundedInteger(env.LEADSHELF_PROOF_AI_MAX_PER_WINDOW, 100, 1, 100_000),
    windowMs: boundedInteger(env.LEADSHELF_PROOF_AI_WINDOW_MS, 60 * 60_000, 60_000, 24 * 60 * 60_000),
  }
}

export function consumeProofAiBudget(
  prisma: PrismaClient,
  organizationId: string,
  now: Date,
): Promise<RateLimitResult> {
  return consumeDurableRateLimit(
    (strings, ...values) => prisma.$queryRaw<RateLimitRow[]>(strings, ...values),
    "proof-ai",
    organizationId,
    proofAiRateLimitRule(),
    now,
  )
}

function stableInputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function proofAnalysisRetryDelayMs(attempt: number, baseMs = 60_000, maxMs = 60 * 60_000): number {
  return Math.min(
    Math.max(1_000, maxMs),
    Math.max(1_000, baseMs) * 2 ** Math.max(0, Math.floor(attempt) - 1),
  )
}

export function classifyProofAnalysisError(message: string): "permanent" | "retryable" {
  return message === "openai_api_key_missing" || message === "gemini_api_key_missing"
    ? "permanent"
    : "retryable"
}

function sourceExt(mimeType: string | null): string {
  if (mimeType === "video/quicktime") return "mov"
  if (mimeType === "video/webm") return "webm"
  return "mp4"
}

function framePlanFromExif(exif: unknown, durationMs: number | null): { timestampsMs: number[]; strategy: string } {
  const qualityCheck = asRecord(asRecord(exif).qualityCheck)
  const framePlan = asRecord(qualityCheck.framePlan)
  const timestamps = Array.isArray(framePlan.timestampsMs)
    ? framePlan.timestampsMs.filter((value): value is number => Number.isFinite(value))
    : []
  if (timestamps.length > 0) {
    return {
      timestampsMs: timestamps.map((value) => Math.max(0, Math.floor(value))),
      strategy: typeof framePlan.strategy === "string" ? framePlan.strategy : "stored_frame_plan",
    }
  }
  const generated = selectProofVideoFrameTimestamps({
    durationMs: durationMs ?? 0,
    maxFrames: Number(process.env.LEADSHELF_PROOF_VIDEO_MAX_FRAMES ?? 8),
  })
  return generated
}

async function claimNextVideo(
  prisma: PrismaClient,
  now: Date,
  organizationId?: string,
): Promise<string | null> {
  const maxAttempts = Math.max(1, Number(process.env.LEADSHELF_PROOF_ANALYSIS_MAX_ATTEMPTS ?? 3))
  const staleBefore = new Date(now.getTime() - Math.max(60_000, Number(process.env.LEADSHELF_PROOF_ANALYSIS_STALE_MS ?? 15 * 60_000)))
  const retryBaseMs = Math.max(1_000, Number(process.env.LEADSHELF_PROOF_ANALYSIS_RETRY_MS ?? 60_000))
  const retryClauses: Prisma.PhotoSubmissionWhereInput[] = Array.from(
    { length: Math.max(0, maxAttempts - 1) },
    (_, index) => {
      const attempts = index + 1
      return {
        analysisStatus: "FAILED",
        analysisAttempts: attempts,
        analysisFinishedAt: { lt: new Date(now.getTime() - proofAnalysisRetryDelayMs(attempts, retryBaseMs)) },
      }
    },
  )
  const candidate = await prisma.photoSubmission.findFirst({
    where: {
      organizationId,
      mediaType: { in: ["PHOTO", "VIDEO"] },
      analysisAttempts: { lt: maxAttempts },
      OR: [
        { analysisStatus: "PENDING" },
        { analysisStatus: "PROCESSING", analysisStartedAt: { lt: staleBefore } },
        ...retryClauses,
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, analysisStatus: true, analysisAttempts: true },
  })
  if (!candidate) return null
  const claimed = await prisma.photoSubmission.updateMany({
    where: {
      id: candidate.id,
      analysisStatus: candidate.analysisStatus,
      analysisAttempts: candidate.analysisAttempts,
    },
    data: {
      analysisStatus: "PROCESSING",
      analysisAttempts: { increment: 1 },
      analysisStartedAt: now,
      analysisError: null,
    },
  })
  return claimed.count === 1 ? candidate.id : null
}

async function findActiveReference(
  prisma: PrismaClient,
  organizationId: string,
  planogramVersionId: string,
): Promise<{
  id: string
  imageUrl: string
  slots: VisionReferenceSlot[]
} | null> {
  const reference = await prisma.goldenReference.findFirst({
    where: { organizationId, planogramVersionId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageUrl: true,
      slots: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          placementId: true,
          productId: true,
          label: true,
          xPct: true,
          yPct: true,
          widthPct: true,
          heightPct: true,
          product: { select: { sku: true } },
        },
      },
    },
  })
  if (!reference) return null
  return {
    id: reference.id,
    imageUrl: reference.imageUrl,
    slots: reference.slots.map((slot) => ({
      id: slot.id,
      placementId: slot.placementId,
      productId: slot.productId,
      productSku: slot.product?.sku ?? null,
      label: slot.label,
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    })),
  }
}

async function expectedPlacements(
  prisma: PrismaClient,
  planogramVersionId: string,
): Promise<ShelfExpectedPlacement[]> {
  const placements = await prisma.planogramPlacement.findMany({
    where: { planogramVersionId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      shelfId: true,
      facingsX: true,
      facingsY: true,
      sortOrder: true,
      product: { select: { id: true, sku: true, name: true, brand: { select: { name: true } } } },
    },
  })
  return placements.map((placement) => ({
    placementId: placement.id,
    shelfId: placement.shelfId,
    productId: placement.product.id,
    productSku: placement.product.sku,
    productName: placement.product.name,
    brand: placement.product.brand?.name ?? null,
    expectedFacings: Math.max(1, placement.facingsX) * Math.max(1, placement.facingsY),
    sortOrder: placement.sortOrder,
  }))
}

async function persistUnavailableAnalysis(
  prisma: PrismaClient,
  input: {
    organizationId: string
    photoSubmissionId: string
    taskId: string | null
    planogramVersionId: string | null
    attempt: number
    reason: string
    identity: ProofAnalysisIdentity
    now: Date
  },
) {
  const expected = input.planogramVersionId
    ? await expectedPlacements(prisma, input.planogramVersionId)
    : []
  const result = compareShelf({ expected, detections: [], analysisAvailable: false })
  const persistedInput = {
    photoSubmissionId: input.photoSubmissionId,
    planogramVersionId: input.planogramVersionId,
    reason: input.reason,
  }
  const inputHash = stableInputHash(persistedInput)
  const { run } = await startShelfAnalysisRun(prisma, input.organizationId, {
    photoSubmissionId: input.photoSubmissionId,
    taskId: input.taskId,
    planogramVersionId: input.planogramVersionId,
    idempotencyKey: `proof:${input.photoSubmissionId}:attempt:${input.attempt}:${inputHash}:${input.identity.provider}:${input.identity.modelVersion}`,
    inputHash,
    provider: input.identity.provider,
    modelVersion: input.identity.modelVersion,
    comparisonVersion: SHELF_COMPARISON_VERSION,
    attempt: input.attempt,
    input: persistedInput,
    startedAt: input.now,
  })
  const finished = await finishShelfAnalysisRun(prisma, input.organizationId, {
    runId: run.id,
    status: "UNAVAILABLE",
    result: result as unknown as Prisma.InputJsonValue,
    warnings: [...result.warnings, input.reason],
    error: input.reason,
    finishedAt: input.now,
  })
  await persistShelfMetricSnapshot(prisma, input.organizationId, finished.id)
  return run.id
}

async function upsertVisionReview(
  prisma: PrismaClient,
  input: {
    organizationId: string
    taskId: string | null
    photoSubmissionId: string
    planogramVersionId: string | null
    goldenReferenceId: string | null
    score: number | null
    findings: Prisma.JsonObject
    note: string
  },
): Promise<string> {
  const existing = await prisma.humanReview.findFirst({
    where: {
      organizationId: input.organizationId,
      photoSubmissionId: input.photoSubmissionId,
      reason: "VISION_COMPLIANCE",
    },
    select: { id: true },
  })
  if (existing) {
    const manualWinner = await prisma.shelfAnalysisRun.findFirst({
      where: {
        organizationId: input.organizationId,
        photoSubmissionId: input.photoSubmissionId,
        source: "MANUAL",
        isCanonical: true,
      },
      select: { id: true },
    })
    if (manualWinner) return existing.id
    const review = await prisma.humanReview.update({
      where: { id: existing.id },
      data: {
        taskId: input.taskId,
        planogramVersionId: input.planogramVersionId,
        goldenReferenceId: input.goldenReferenceId,
        score: input.score,
        findings: input.findings,
        note: input.note,
      },
      select: { id: true },
    })
    return review.id
  }
  const review = await prisma.humanReview.create({
    data: {
      organizationId: input.organizationId,
      reason: "VISION_COMPLIANCE",
      status: "PENDING",
      taskId: input.taskId,
      photoSubmissionId: input.photoSubmissionId,
      planogramVersionId: input.planogramVersionId,
      goldenReferenceId: input.goldenReferenceId,
      score: input.score,
      findings: input.findings,
      note: input.note,
    },
    select: { id: true },
  })
  return review.id
}

async function markSkipped(
  prisma: PrismaClient,
  input: {
    photoSubmissionId: string
    organizationId: string
    taskId: string | null
    planogramVersionId: string | null
    attempt: number
    identity: ProofAnalysisIdentity
    reason: string
    now: Date
  },
): Promise<void> {
  await persistUnavailableAnalysis(prisma, {
    organizationId: input.organizationId,
    photoSubmissionId: input.photoSubmissionId,
    taskId: input.taskId,
    planogramVersionId: input.planogramVersionId,
    attempt: input.attempt,
    reason: input.reason,
    identity: input.identity,
    now: input.now,
  })
  const findings = {
    vision: {
      workerStatus: "skipped",
      provider: null,
      modelVersion: null,
      reason: input.reason,
      scannedAt: input.now.toISOString(),
      warnings: [input.reason],
    },
  } satisfies Prisma.JsonObject
  await prisma.photoSubmission.update({
    where: { id: input.photoSubmissionId },
    data: {
      analysisStatus: "SKIPPED",
      analysisError: input.reason,
      analysisFinishedAt: input.now,
    },
  })
  await upsertVisionReview(prisma, {
    organizationId: input.organizationId,
    taskId: input.taskId,
    photoSubmissionId: input.photoSubmissionId,
    planogramVersionId: input.planogramVersionId,
    goldenReferenceId: null,
    score: null,
    findings,
    note: `Proof analysis skipped: ${input.reason}.`,
  })
}

async function markFailed(
  prisma: PrismaClient,
  input: {
    photoSubmissionId: string
    organizationId: string
    taskId: string | null
    planogramVersionId: string | null
    attempt: number
    identity: ProofAnalysisIdentity
    error: string
    now: Date
  },
): Promise<void> {
  await persistUnavailableAnalysis(prisma, {
    organizationId: input.organizationId,
    photoSubmissionId: input.photoSubmissionId,
    taskId: input.taskId,
    planogramVersionId: input.planogramVersionId,
    attempt: input.attempt,
    reason: input.error,
    identity: input.identity,
    now: input.now,
  })
  const findings = {
    vision: {
      workerStatus: "failed",
      provider: null,
      modelVersion: null,
      error: input.error,
      scannedAt: input.now.toISOString(),
      warnings: [input.error],
    },
  } satisfies Prisma.JsonObject
  await prisma.photoSubmission.update({
    where: { id: input.photoSubmissionId },
    data: {
      analysisStatus: "FAILED",
      analysisError: input.error,
      analysisFinishedAt: input.now,
    },
  })
  await upsertVisionReview(prisma, {
    organizationId: input.organizationId,
    taskId: input.taskId,
    photoSubmissionId: input.photoSubmissionId,
    planogramVersionId: input.planogramVersionId,
    goldenReferenceId: null,
    score: null,
    findings,
    note: `Proof analysis failed: ${input.error}.`,
  })
}

function analysisFindings(input: {
  result: ProofFrameAnalysisResult
  frameKeys: Array<{ key: string; timestampMs: number }>
  scannedAt: Date
}): Prisma.JsonObject {
  const { response } = input.result
  const vision = {
    workerStatus: "completed",
    scannedAt: input.scannedAt.toISOString(),
    protocolVersion: response.protocolVersion,
    provider: response.provider,
    modelVersion: response.modelVersion,
    status: response.status,
    compliance: response.compliance,
    findings: response.findings,
    detections: response.detections,
    aiFindings: input.result.aiFindings,
    summary: input.result.rawSummary,
    selectedFrames: input.frameKeys,
    warnings: response.warnings,
  } as unknown as Prisma.JsonObject
  return {
    vision,
  } satisfies Prisma.JsonObject
}

export async function processNextProofAnalysisJob(
  prisma: PrismaClient,
  deps: ProcessProofVideoAnalysisDeps = {},
): Promise<ProcessProofVideoAnalysisResult> {
  const now = deps.now?.() ?? new Date()
  const identity = deps.analysisIdentity ?? configuredProofAnalysisIdentity()
  const photoSubmissionId = await claimNextVideo(prisma, now, deps.organizationId)
  if (!photoSubmissionId) return { status: "empty" }

  const storage = deps.storage ?? { getObjectBuffer, putObjectBuffer }
  const extractor = deps.extractor ?? new FfmpegProofFrameExtractor()
  const analyze = deps.analyze ?? analyzeSelectedProofFrames

  const photo = await prisma.photoSubmission.findUnique({
    where: { id: photoSubmissionId },
    select: {
      id: true,
      organizationId: true,
      url: true,
      mediaType: true,
      mimeType: true,
      durationMs: true,
      taskId: true,
      analysisAttempts: true,
      exif: true,
      user: { select: { organizationId: true } },
      store: { select: { organizationId: true } },
      visit: { select: { organizationId: true } },
      task: {
        select: {
          organizationId: true,
          planogramVersionId: true,
          planogramVersion: {
            select: { planogram: { select: { organizationId: true } } },
          },
        },
      },
    },
  })
  if (!photo) return { status: "failed", photoSubmissionId, error: "photo_not_found_after_claim" }
  const boundaryViolation =
    photo.user.organizationId !== photo.organizationId ||
    photo.store.organizationId !== photo.organizationId ||
    (photo.visit != null && photo.visit.organizationId !== photo.organizationId) ||
    (photo.task != null && photo.task.organizationId !== photo.organizationId) ||
    (photo.task?.planogramVersion != null &&
      photo.task.planogramVersion.planogram.organizationId !== photo.organizationId)
  if (boundaryViolation) {
    await prisma.photoSubmission.updateMany({
      where: { id: photo.id, organizationId: photo.organizationId, analysisStatus: "PROCESSING" },
      data: {
        analysisStatus: "FAILED",
        analysisError: "tenant_boundary_violation",
        analysisFinishedAt: now,
      },
    })
    return { status: "failed", photoSubmissionId, error: "tenant_boundary_violation" }
  }
  const planogramVersionId = photo.task?.planogramVersionId ?? null

  try {
    if (!planogramVersionId) {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
        attempt: photo.analysisAttempts,
        identity,
        reason: "proof_without_planogram_version",
        now,
      })
      return { status: "skipped", photoSubmissionId, reason: "proof_without_planogram_version" }
    }

    const reference = await findActiveReference(prisma, photo.organizationId, planogramVersionId)
    if (!reference) {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
        attempt: photo.analysisAttempts,
        identity,
        reason: "active_golden_reference_not_found",
        now,
      })
      return { status: "skipped", photoSubmissionId, reason: "active_golden_reference_not_found" }
    }
    if (reference.slots.length === 0) {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
        attempt: photo.analysisAttempts,
        identity,
        reason: "active_golden_reference_has_no_slots",
        now,
      })
      return { status: "skipped", photoSubmissionId, reason: "active_golden_reference_has_no_slots" }
    }

    if (identity.provider === "openai" || identity.provider === "gemini") {
      const budget = await (deps.consumeAiBudget ?? consumeProofAiBudget)(
        prisma,
        photo.organizationId,
        now,
      )
      if (!budget.allowed) {
        await markSkipped(prisma, {
          photoSubmissionId,
          organizationId: photo.organizationId,
          taskId: photo.taskId,
          planogramVersionId,
          attempt: photo.analysisAttempts,
          identity,
          reason: "proof_ai_rate_limited",
          now,
        })
        return { status: "skipped", photoSubmissionId, reason: "proof_ai_rate_limited" }
      }
    }

    const proof = await storage.getObjectBuffer(photo.url)
    if (!proof) throw new Error("proof_object_not_found")

    let framePlan: { timestampsMs: number[]; strategy: string }
    let frames: ExtractedProofFrame[]
    const frameKeys: Array<{ key: string; timestampMs: number }> = []
    if (photo.mediaType === "VIDEO") {
      framePlan = framePlanFromExif(photo.exif, photo.durationMs)
      if (framePlan.timestampsMs.length === 0) throw new Error("video_frame_plan_empty")
      frames = await extractor.extract({
        video: proof.body,
        timestampsMs: framePlan.timestampsMs,
        sourceExt: sourceExt(photo.mimeType),
      })
      if (frames.length === 0) throw new Error("video_frame_extraction_empty")
      for (const frame of frames) {
        const key = proofFrameKey({
          organizationId: photo.organizationId,
          photoSubmissionId: photo.id,
          timestampMs: frame.timestampMs,
        })
        await storage.putObjectBuffer(key, frame.buffer, frame.contentType)
        frameKeys.push({ key, timestampMs: frame.timestampMs })
      }
    } else {
      framePlan = { timestampsMs: [0], strategy: "photo" }
      frames = [{ timestampMs: 0, buffer: proof.body, contentType: proof.contentType }]
      frameKeys.push({ key: photo.url, timestampMs: 0 })
    }

    const request: VisionScanRequest = {
      protocolVersion: VISION_PROTOCOL_VERSION,
      organizationId: photo.organizationId,
      planogramVersionId,
      photoSubmissionId: photo.id,
      photoUrl: photo.url,
      goldenReferenceId: reference.id,
      goldenReferenceUrl: reference.imageUrl,
      slots: reference.slots,
    }
    const expected = await expectedPlacements(prisma, planogramVersionId)
    const persistedInput = { request, expected }
    const inputHash = stableInputHash(persistedInput)
    const startedAt = deps.now?.() ?? new Date()
    const { run } = await startShelfAnalysisRun(prisma, photo.organizationId, {
      photoSubmissionId: photo.id,
      taskId: photo.taskId,
      planogramVersionId,
      goldenReferenceId: reference.id,
      idempotencyKey: `proof:${photo.id}:attempt:${photo.analysisAttempts}:${inputHash}:${identity.provider}:${identity.modelVersion}`,
      inputHash,
      provider: identity.provider,
      modelVersion: identity.modelVersion,
      comparisonVersion: SHELF_COMPARISON_VERSION,
      attempt: photo.analysisAttempts,
      input: persistedInput as unknown as Prisma.InputJsonValue,
      startedAt,
    })
    const result = await analyze(request, frames)
    const scannedAt = deps.now?.() ?? new Date()
    const findings = analysisFindings({ result, frameKeys, scannedAt })
    const comparison = compareShelf({
      expected,
      referenceSlots: reference.slots
        .filter((slot) => slot.placementId != null)
        .map((slot) => ({ slotId: slot.id, placementId: slot.placementId! })),
      detections: result.response.detections.map((detection, index) => ({
        detectionId: detection.slotId ?? `detection-${index + 1}`,
        slotId: detection.slotId,
        productId: detection.productId,
        productSku: detection.productSku,
        label: detection.label,
        confidence: detection.confidence,
        bbox: detection.bbox,
        source: "ai" as const,
      })),
      analysisAvailable: result.response.status !== "failed",
    })
    const finishedRun = await finishShelfAnalysisRun(prisma, photo.organizationId, {
      runId: run.id,
      status:
        comparison.status === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : comparison.status === "REVIEW"
            ? "REVIEW"
            : "COMPLETED",
      result: comparison as unknown as Prisma.InputJsonValue,
      warnings: comparison.warnings,
      inputTokens: result.telemetry?.inputTokens ?? null,
      outputTokens: result.telemetry?.outputTokens ?? null,
      costMicros: result.telemetry?.costMicros ?? null,
      finishedAt: scannedAt,
    })
    await persistShelfMetricSnapshot(prisma, photo.organizationId, finishedRun.id)
    const exif = asJsonObject(photo.exif)
    const nextExif = {
      ...exif,
      videoFrameExtraction: {
        framePlan,
        selectedFrames: frameKeys,
        extractedAt: scannedAt.toISOString(),
      },
      selectedFrameAnalysis: asJsonObject(findings.vision),
    } as Prisma.InputJsonObject

    const reviewId = await prisma.$transaction(async (tx) => {
      await tx.photoSubmission.update({
        where: { id: photo.id },
        data: {
          exif: nextExif,
          analysisStatus: "COMPLETED",
          analysisProvider: result.response.provider,
          analysisModelVersion: result.response.modelVersion,
          analysisError: null,
          analysisFinishedAt: scannedAt,
        },
      })
      return upsertVisionReview(tx as PrismaClient, {
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        photoSubmissionId: photo.id,
        planogramVersionId,
        goldenReferenceId: reference.id,
        score: result.response.compliance.score,
        findings,
        note: "Persisted shelf comparison created from proof media.",
      })
    })
    await prisma.shelfAnalysisRun.updateMany({
      where: { id: run.id, organizationId: photo.organizationId },
      data: { humanReviewId: reviewId },
    })

    return {
      status: "completed",
      photoSubmissionId,
      reviewId,
      provider: result.response.provider,
      modelVersion: result.response.modelVersion,
    }
  } catch (error) {
    const message = truncateError(error)
    const failedAt = deps.now?.() ?? new Date()
    const status = classifyProofAnalysisError(message) === "permanent" ? "skipped" : "failed"
    if (status === "skipped") {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
        attempt: photo.analysisAttempts,
        identity,
        reason: message,
        now: failedAt,
      })
      return { status: "skipped", photoSubmissionId, reason: message }
    }
    await markFailed(prisma, {
      photoSubmissionId,
      organizationId: photo.organizationId,
      taskId: photo.taskId,
      planogramVersionId,
      attempt: photo.analysisAttempts,
      identity,
      error: message,
      now: failedAt,
    })
    return { status: "failed", photoSubmissionId, error: message }
  }
}

// Backward-compatible export for existing runner/tests while callers migrate
// to the media-neutral name.
export const processNextProofVideoAnalysisJob = processNextProofAnalysisJob
