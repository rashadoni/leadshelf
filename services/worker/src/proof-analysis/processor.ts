import type { PrismaClient } from "@prisma/client"
import { Prisma } from "@prisma/client"
import {
  VISION_PROTOCOL_VERSION,
  type VisionReferenceSlot,
  type VisionScanRequest,
} from "@leadshelf/api-contracts/vision/v1"
import { selectProofVideoFrameTimestamps } from "@leadshelf/core"
import { analyzeSelectedProofFrames, type ProofFrameAnalysisResult } from "./analyzer"
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
  now?: () => Date
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

async function claimNextVideo(prisma: PrismaClient): Promise<string | null> {
  const candidate = await prisma.photoSubmission.findFirst({
    where: { mediaType: "VIDEO", analysisStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (!candidate) return null
  const claimed = await prisma.photoSubmission.updateMany({
    where: { id: candidate.id, analysisStatus: "PENDING" },
    data: {
      analysisStatus: "PROCESSING",
      analysisAttempts: { increment: 1 },
      analysisStartedAt: new Date(),
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
    reason: string
    now: Date
  },
): Promise<void> {
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
    note: `Video proof analysis skipped: ${input.reason}.`,
  })
}

async function markFailed(
  prisma: PrismaClient,
  input: {
    photoSubmissionId: string
    organizationId: string
    taskId: string | null
    planogramVersionId: string | null
    error: string
    now: Date
  },
): Promise<void> {
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
    note: `Video proof analysis failed: ${input.error}.`,
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

export async function processNextProofVideoAnalysisJob(
  prisma: PrismaClient,
  deps: ProcessProofVideoAnalysisDeps = {},
): Promise<ProcessProofVideoAnalysisResult> {
  const photoSubmissionId = await claimNextVideo(prisma)
  if (!photoSubmissionId) return { status: "empty" }

  const now = deps.now?.() ?? new Date()
  const storage = deps.storage ?? { getObjectBuffer, putObjectBuffer }
  const extractor = deps.extractor ?? new FfmpegProofFrameExtractor()
  const analyze = deps.analyze ?? analyzeSelectedProofFrames

  const photo = await prisma.photoSubmission.findUnique({
    where: { id: photoSubmissionId },
    select: {
      id: true,
      organizationId: true,
      url: true,
      mimeType: true,
      durationMs: true,
      taskId: true,
      exif: true,
      task: { select: { planogramVersionId: true } },
    },
  })
  if (!photo) return { status: "failed", photoSubmissionId, error: "photo_not_found_after_claim" }
  const planogramVersionId = photo.task?.planogramVersionId ?? null

  try {
    if (!planogramVersionId) {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
        reason: "video_without_planogram_version",
        now,
      })
      return { status: "skipped", photoSubmissionId, reason: "video_without_planogram_version" }
    }

    const reference = await findActiveReference(prisma, photo.organizationId, planogramVersionId)
    if (!reference) {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
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
        reason: "active_golden_reference_has_no_slots",
        now,
      })
      return { status: "skipped", photoSubmissionId, reason: "active_golden_reference_has_no_slots" }
    }

    const video = await storage.getObjectBuffer(photo.url)
    if (!video) throw new Error("video_object_not_found")

    const framePlan = framePlanFromExif(photo.exif, photo.durationMs)
    if (framePlan.timestampsMs.length === 0) throw new Error("video_frame_plan_empty")

    const frames = await extractor.extract({
      video: video.body,
      timestampsMs: framePlan.timestampsMs,
      sourceExt: sourceExt(photo.mimeType),
    })
    if (frames.length === 0) throw new Error("video_frame_extraction_empty")

    const frameKeys: Array<{ key: string; timestampMs: number }> = []
    for (const frame of frames) {
      const key = proofFrameKey({
        organizationId: photo.organizationId,
        photoSubmissionId: photo.id,
        timestampMs: frame.timestampMs,
      })
      await storage.putObjectBuffer(key, frame.buffer, frame.contentType)
      frameKeys.push({ key, timestampMs: frame.timestampMs })
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
    const result = await analyze(request, frames)
    const scannedAt = deps.now?.() ?? new Date()
    const findings = analysisFindings({ result, frameKeys, scannedAt })
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
        note: "Selected-frame vision compliance check created from video proof.",
      })
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
    const status = message === "openai_api_key_missing" ? "skipped" : "failed"
    if (status === "skipped") {
      await markSkipped(prisma, {
        photoSubmissionId,
        organizationId: photo.organizationId,
        taskId: photo.taskId,
        planogramVersionId,
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
      error: message,
      now: failedAt,
    })
    return { status: "failed", photoSubmissionId, error: message }
  }
}
