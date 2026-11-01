import { Prisma, type PrismaClient } from "@leadshelf/prisma-client"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Materializes filter-friendly analytics from a canonical comparison run. */
export async function persistShelfMetricSnapshot(
  prisma: PrismaClient,
  organizationId: string,
  analysisRunId: string,
) {
  const run = await prisma.shelfAnalysisRun.findFirst({
    where: { id: analysisRunId, organizationId, isCanonical: true },
    select: {
      id: true,
      taskId: true,
      planogramVersionId: true,
      result: true,
      photoSubmission: { select: { storeId: true, userId: true, takenAt: true } },
    },
  })
  if (!run?.result) return null
  const result = record(run.result)
  const metrics = record(result.metrics)
  const structuralScore = finiteNumber(result.structuralScore)
  const visualConfidence = finiteNumber(result.visualConfidence)
  const actualFacings = finiteNumber(metrics.actualFacings)
  const data = {
    organizationId,
    analysisRunId: run.id,
    storeId: run.photoSubmission.storeId,
    agentId: run.photoSubmission.userId,
    taskId: run.taskId,
    planogramVersionId: run.planogramVersionId,
    capturedAt: run.photoSubmission.takenAt,
    status: typeof result.status === "string" ? result.status : "UNAVAILABLE",
    structuralScore,
    visualConfidence,
    oosCount: array(metrics.oos).length,
    expectedFacings: Math.max(0, Math.floor(finiteNumber(metrics.expectedFacings) ?? 0)),
    actualFacings: actualFacings == null ? null : Math.max(0, Math.floor(actualFacings)),
    actionCount: array(result.actions).length,
    share: {
      shareOfShelf: array(metrics.shareOfShelf),
      brandShare: array(metrics.brandShare),
      ourBrandSharePct: finiteNumber(metrics.ourBrandSharePct),
      competitorSharePct: finiteNumber(metrics.competitorSharePct),
    } as Prisma.InputJsonValue,
  }
  return prisma.shelfMetricSnapshot.upsert({
    where: { analysisRunId: run.id },
    create: data,
    update: data,
  })
}

export interface ShelfAnalyticsRow {
  status: string
  structuralScore: number | null
  visualConfidence: number | null
  oosCount: number
  expectedFacings: number
  actualFacings: number | null
  actionCount: number
}

export interface ShelfAnalyticsSummary {
  samples: number
  availableSamples: number
  unavailableSamples: number
  averageStructuralScore: number | null
  averageVisualConfidence: number | null
  oosCount: number
  expectedFacings: number
  actualFacings: number
  facingsGap: number
  actionCount: number
  reviewPending: number
  reviewApproved: number
  reviewRejected: number
  retakeRequests: number
}

export function buildShelfAnalytics(rows: ShelfAnalyticsRow[]): ShelfAnalyticsSummary {
  let structuralTotal = 0
  let structuralCount = 0
  let confidenceTotal = 0
  let confidenceCount = 0
  let oosCount = 0
  let expectedFacings = 0
  let actualFacings = 0
  let actionCount = 0
  let unavailableSamples = 0
  for (const row of rows) {
    if (row.structuralScore == null) unavailableSamples += 1
    else {
      structuralTotal += row.structuralScore
      structuralCount += 1
    }
    if (row.visualConfidence != null) {
      confidenceTotal += row.visualConfidence
      confidenceCount += 1
    }
    oosCount += row.oosCount
    expectedFacings += row.expectedFacings
    actualFacings += row.actualFacings ?? 0
    actionCount += row.actionCount
  }
  return {
    samples: rows.length,
    availableSamples: structuralCount,
    unavailableSamples,
    averageStructuralScore: structuralCount ? Math.round((structuralTotal / structuralCount) * 10) / 10 : null,
    averageVisualConfidence: confidenceCount ? Math.round((confidenceTotal / confidenceCount) * 1000) / 1000 : null,
    oosCount,
    expectedFacings,
    actualFacings,
    facingsGap: Math.max(0, expectedFacings - actualFacings),
    actionCount,
    reviewPending: 0,
    reviewApproved: 0,
    reviewRejected: 0,
    retakeRequests: 0,
  }
}

export async function getShelfAnalytics(
  prisma: PrismaClient,
  organizationId: string,
  filters: {
    from?: Date
    to?: Date
    storeId?: string
    agentId?: string
    planogramVersionId?: string
    status?: string
  } = {},
): Promise<ShelfAnalyticsSummary> {
  const capturedAt = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined
  const [rows, reviews, retakeRequests] = await Promise.all([
    prisma.shelfMetricSnapshot.findMany({
    where: {
      organizationId,
      storeId: filters.storeId,
      agentId: filters.agentId,
      planogramVersionId: filters.planogramVersionId,
      status: filters.status,
      capturedAt,
    },
    orderBy: { capturedAt: "desc" },
    take: 10_000,
    select: {
      status: true,
      structuralScore: true,
      visualConfidence: true,
      oosCount: true,
      expectedFacings: true,
      actualFacings: true,
      actionCount: true,
    },
    }),
    prisma.humanReview.findMany({
      where: {
        organizationId,
        reason: "VISION_COMPLIANCE",
        planogramVersionId: filters.planogramVersionId,
        photoSubmission: {
          is: {
            storeId: filters.storeId,
            userId: filters.agentId,
            takenAt: capturedAt,
          },
        },
      },
      select: { status: true },
      take: 10_000,
    }),
    prisma.captureRetakeRequest.count({
      where: {
        organizationId,
        requestedAt: capturedAt,
        task: {
          storeId: filters.storeId,
          assigneeId: filters.agentId,
          planogramVersionId: filters.planogramVersionId,
        },
      },
    }),
  ])
  const summary = buildShelfAnalytics(rows)
  return {
    ...summary,
    reviewPending: reviews.filter((review) => review.status === "PENDING").length,
    reviewApproved: reviews.filter((review) => review.status === "APPROVED").length,
    reviewRejected: reviews.filter((review) => review.status === "REJECTED").length,
    retakeRequests,
  }
}
