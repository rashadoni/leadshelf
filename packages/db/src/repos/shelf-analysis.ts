import { createHash } from "node:crypto"
import { Prisma, type PrismaClient, type ShelfAnalysisRun, type ShelfAnalysisRunStatus } from "@prisma/client"
import { compareShelf, SHELF_COMPARISON_VERSION, type ShelfBBox } from "@leadshelf/core"
import { persistShelfMetricSnapshot } from "./shelf-analytics.ts"

export class ShelfAnalysisRepoError extends Error {
  constructor(public code: "analysis_reference_not_found" | "analysis_run_not_found") {
    super(code)
  }
}

export interface StartShelfAnalysisRunInput {
  photoSubmissionId: string
  taskId?: string | null
  planogramVersionId?: string | null
  goldenReferenceId?: string | null
  humanReviewId?: string | null
  source?: "AUTO" | "MANUAL"
  idempotencyKey: string
  inputHash: string
  provider: string
  modelVersion: string
  comparisonVersion: number
  attempt?: number
  input: Prisma.InputJsonValue
  startedAt?: Date | null
}

export interface FinishShelfAnalysisRunInput {
  runId: string
  status: Exclude<ShelfAnalysisRunStatus, "PENDING" | "PROCESSING">
  result?: Prisma.InputJsonValue | null
  warnings?: Prisma.InputJsonValue | null
  error?: string | null
  humanReviewId?: string | null
  latencyMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  costMicros?: number | null
  finishedAt?: Date
}

export interface ManualShelfAnnotationInput {
  id: string
  placementId?: string | null
  productId?: string | null
  facings: number
  bbox: ShelfBBox
}

async function assertTenantReferences(
  prisma: PrismaClient,
  organizationId: string,
  input: StartShelfAnalysisRunInput,
): Promise<void> {
  const [photo, task, version, reference, review] = await Promise.all([
    prisma.photoSubmission.findFirst({
      where: { id: input.photoSubmissionId, organizationId },
      select: { id: true },
    }),
    input.taskId
      ? prisma.task.findFirst({ where: { id: input.taskId, organizationId }, select: { id: true } })
      : Promise.resolve({ id: "none" }),
    input.planogramVersionId
      ? prisma.planogramVersion.findFirst({
          where: { id: input.planogramVersionId, planogram: { organizationId } },
          select: { id: true },
        })
      : Promise.resolve({ id: "none" }),
    input.goldenReferenceId
      ? prisma.goldenReference.findFirst({
          where: { id: input.goldenReferenceId, organizationId },
          select: { id: true },
        })
      : Promise.resolve({ id: "none" }),
    input.humanReviewId
      ? prisma.humanReview.findFirst({
          where: { id: input.humanReviewId, organizationId },
          select: { id: true },
        })
      : Promise.resolve({ id: "none" }),
  ])
  if (!photo || !task || !version || !reference || !review) {
    throw new ShelfAnalysisRepoError("analysis_reference_not_found")
  }
}

/**
 * Creates the durable run before inference starts. Repeated delivery with the
 * same idempotency key returns the original run instead of duplicating work.
 */
export async function startShelfAnalysisRun(
  prisma: PrismaClient,
  organizationId: string,
  input: StartShelfAnalysisRunInput,
) {
  await assertTenantReferences(prisma, organizationId, input)
  const existing = await prisma.shelfAnalysisRun.findFirst({
    where: { organizationId, idempotencyKey: input.idempotencyKey },
  })
  if (existing) return { run: existing, created: false }

  try {
    const run = await prisma.shelfAnalysisRun.create({
      data: {
        organizationId,
        photoSubmissionId: input.photoSubmissionId,
        taskId: input.taskId ?? null,
        planogramVersionId: input.planogramVersionId ?? null,
        goldenReferenceId: input.goldenReferenceId ?? null,
        humanReviewId: input.humanReviewId ?? null,
        source: input.source ?? "AUTO",
        status: input.startedAt ? "PROCESSING" : "PENDING",
        idempotencyKey: input.idempotencyKey,
        inputHash: input.inputHash,
        provider: input.provider,
        modelVersion: input.modelVersion,
        comparisonVersion: input.comparisonVersion,
        attempt: input.attempt ?? 1,
        input: input.input,
        startedAt: input.startedAt ?? null,
      },
    })
    return { run, created: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const run = await prisma.shelfAnalysisRun.findFirst({
      where: { organizationId, idempotencyKey: input.idempotencyKey },
    })
    if (!run) throw error
    return { run, created: false }
  }
}

/**
 * Completes a persisted run and atomically advances the canonical pointer.
 * A canonical manual run always wins over later automatic runs.
 */
export async function finishShelfAnalysisRun(
  prisma: PrismaClient,
  organizationId: string,
  input: FinishShelfAnalysisRunInput,
) {
  return prisma.$transaction(async (tx) => {
    const runRef = await tx.shelfAnalysisRun.findFirst({
      where: { id: input.runId, organizationId },
      select: { photoSubmissionId: true },
    })
    if (!runRef) throw new ShelfAnalysisRepoError("analysis_run_not_found")
    // Все canonical-переходы одного proof сериализуются на родительской
    // строке. Это закрывает гонку AUTO finish vs MANUAL save.
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "photo_submissions" WHERE "id" = ${runRef.photoSubmissionId} AND "organizationId" = ${organizationId} FOR UPDATE`,
    )
    const existing = await tx.shelfAnalysisRun.findFirst({
      where: { id: input.runId, organizationId },
    })
    if (!existing) throw new ShelfAnalysisRepoError("analysis_run_not_found")

    const canonicalCandidate = input.status !== "FAILED"
    const manualWinner =
      existing.source === "AUTO" &&
      canonicalCandidate &&
      (await tx.shelfAnalysisRun.count({
        where: {
          organizationId,
          photoSubmissionId: existing.photoSubmissionId,
          source: "MANUAL",
          isCanonical: true,
        },
      })) > 0

    const isCanonical = canonicalCandidate && !manualWinner
    const finishedAt = input.finishedAt ?? new Date()
    if (isCanonical) {
      await tx.shelfAnalysisRun.updateMany({
        where: {
          organizationId,
          photoSubmissionId: existing.photoSubmissionId,
          isCanonical: true,
          id: { not: existing.id },
        },
        data: { isCanonical: false },
      })
    }

    return tx.shelfAnalysisRun.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        result: input.result === null ? Prisma.JsonNull : input.result,
        warnings: input.warnings === null ? Prisma.JsonNull : input.warnings,
        error: input.error ?? null,
        humanReviewId: input.humanReviewId ?? existing.humanReviewId,
        latencyMs: input.latencyMs ?? (existing.startedAt ? Math.max(0, finishedAt.getTime() - existing.startedAt.getTime()) : null),
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        costMicros: input.costMicros ?? null,
        isCanonical,
        finishedAt,
      },
    })
  })
}

export type LatestShelfAnalysis =
  | { source: "RUN"; run: ShelfAnalysisRun }
  | { source: "LEGACY_REVIEW"; reviewId: string; findings: Prisma.JsonValue; score: number | null }
  | null

/** Canonical run first; legacy HumanReview.findings remains a read fallback. */
export async function readLatestShelfAnalysis(
  prisma: PrismaClient,
  organizationId: string,
  photoSubmissionId: string,
): Promise<LatestShelfAnalysis> {
  const run = await prisma.shelfAnalysisRun.findFirst({
    where: { organizationId, photoSubmissionId, isCanonical: true },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
  })
  if (run) return { source: "RUN", run }

  const latestRun = await prisma.shelfAnalysisRun.findFirst({
    where: { organizationId, photoSubmissionId },
    orderBy: { createdAt: "desc" },
  })
  if (latestRun) return { source: "RUN", run: latestRun }

  const legacy = await prisma.humanReview.findFirst({
    where: { organizationId, photoSubmissionId, reason: "VISION_COMPLIANCE", findings: { not: Prisma.DbNull } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, findings: true, score: true },
  })
  return legacy?.findings == null
    ? null
    : { source: "LEGACY_REVIEW", reviewId: legacy.id, findings: legacy.findings, score: legacy.score }
}

function manualInputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Saves trusted human annotations as a canonical comparison and audit event. */
export async function saveManualShelfAnalysis(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    reviewId: string
    reviewedById: string
    annotations: ManualShelfAnnotationInput[]
  },
) {
  const review = await prisma.humanReview.findFirst({
    where: { id: input.reviewId, organizationId },
    select: {
      id: true,
      taskId: true,
      photoSubmissionId: true,
      planogramVersionId: true,
      goldenReferenceId: true,
    },
  })
  if (!review?.photoSubmissionId || !review.planogramVersionId) {
    throw new ShelfAnalysisRepoError("analysis_reference_not_found")
  }

  const [placements, products] = await Promise.all([
    prisma.planogramPlacement.findMany({
      where: { planogramVersionId: review.planogramVersionId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        shelfId: true,
        facingsX: true,
        facingsY: true,
        sortOrder: true,
        product: { select: { id: true, sku: true, name: true, brand: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        id: { in: input.annotations.map((annotation) => annotation.productId).filter((id): id is string => !!id) },
      },
      select: { id: true, sku: true, name: true, brand: { select: { name: true } } },
    }),
  ])
  const placementById = new Map(placements.map((placement) => [placement.id, placement]))
  const productById = new Map(products.map((product) => [product.id, product]))
  if (
    input.annotations.some(
      (annotation) =>
        (annotation.placementId && !placementById.has(annotation.placementId)) ||
        (annotation.productId && !productById.has(annotation.productId)),
    )
  ) {
    throw new ShelfAnalysisRepoError("analysis_reference_not_found")
  }

  const expected = placements.map((placement) => ({
    placementId: placement.id,
    shelfId: placement.shelfId,
    productId: placement.product.id,
    productSku: placement.product.sku,
    productName: placement.product.name,
    brand: placement.product.brand?.name ?? null,
    expectedFacings: Math.max(1, placement.facingsX) * Math.max(1, placement.facingsY),
    sortOrder: placement.sortOrder,
  }))
  const normalizedAnnotations = [...input.annotations]
    .map((annotation) => ({ ...annotation, facings: Math.max(1, Math.floor(annotation.facings)) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const detections = normalizedAnnotations.map((annotation) => {
    const placement = annotation.placementId ? placementById.get(annotation.placementId) : null
    const product = annotation.productId ? productById.get(annotation.productId) : placement?.product
    return {
      detectionId: annotation.id,
      placementId: annotation.placementId ?? null,
      shelfId: placement?.shelfId ?? null,
      productId: product?.id ?? null,
      productSku: product?.sku ?? null,
      label: product?.name ?? null,
      brand: product?.brand?.name ?? null,
      confidence: 1,
      facings: annotation.facings,
      bbox: annotation.bbox,
      source: "manual" as const,
    }
  })
  const result = compareShelf({ expected, detections, analysisAvailable: true })
  const persistedInput = { reviewId: review.id, annotations: normalizedAnnotations }
  const inputHash = manualInputHash(persistedInput)
  const { run } = await startShelfAnalysisRun(prisma, organizationId, {
    photoSubmissionId: review.photoSubmissionId,
    taskId: review.taskId,
    planogramVersionId: review.planogramVersionId,
    goldenReferenceId: review.goldenReferenceId,
    humanReviewId: review.id,
    source: "MANUAL",
    idempotencyKey: `manual:${review.id}:${inputHash}`,
    inputHash,
    provider: "manual",
    modelVersion: "review-editor-v1",
    comparisonVersion: SHELF_COMPARISON_VERSION,
    input: persistedInput as unknown as Prisma.InputJsonValue,
    startedAt: new Date(),
  })
  const finished = await finishShelfAnalysisRun(prisma, organizationId, {
    runId: run.id,
    status: result.status === "REVIEW" ? "REVIEW" : result.status === "UNAVAILABLE" ? "UNAVAILABLE" : "COMPLETED",
    result: result as unknown as Prisma.InputJsonValue,
    warnings: result.warnings,
    humanReviewId: review.id,
  })

  await prisma.$transaction([
    prisma.humanReview.update({
      where: { id: review.id },
      data: {
        score: result.structuralScore == null ? null : result.structuralScore / 100,
        findings: {
          manual: { runId: run.id, provider: "manual", modelVersion: "review-editor-v1" },
          vision: {
            workerStatus: "manual",
            provider: "manual",
            modelVersion: "review-editor-v1",
            status: result.status,
            detections,
            comparison: result,
            warnings: result.warnings,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.auditLog.create({
      data: {
        organizationId,
        userId: input.reviewedById,
        action: "shelf_analysis.manual_saved",
        entityType: "ShelfAnalysisRun",
        entityId: run.id,
        payload: {
          reviewId: review.id,
          photoSubmissionId: review.photoSubmissionId,
          annotationCount: normalizedAnnotations.length,
          inputHash,
          resultStatus: result.status,
        },
      },
    }),
  ])
  await persistShelfMetricSnapshot(prisma, organizationId, finished.id)
  return { run: finished, result }
}
