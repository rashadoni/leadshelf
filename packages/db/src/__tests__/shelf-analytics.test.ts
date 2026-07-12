import { describe, expect, test } from "vitest"
import { buildShelfAnalytics, type ShelfAnalyticsRow } from "../repos/shelf-analytics.ts"

describe("shelf analytics", () => {
  test("keeps unavailable samples out of structural averages", () => {
    expect(buildShelfAnalytics([
      { status: "PASS", structuralScore: 90, visualConfidence: 0.8, oosCount: 1, expectedFacings: 10, actualFacings: 9, actionCount: 1 },
      { status: "REVIEW", structuralScore: 70, visualConfidence: 0.6, oosCount: 2, expectedFacings: 8, actualFacings: 5, actionCount: 3 },
      { status: "UNAVAILABLE", structuralScore: null, visualConfidence: null, oosCount: 0, expectedFacings: 6, actualFacings: null, actionCount: 0 },
    ])).toEqual({
      samples: 3,
      availableSamples: 2,
      unavailableSamples: 1,
      averageStructuralScore: 80,
      averageVisualConfidence: 0.7,
      oosCount: 3,
      expectedFacings: 24,
      actualFacings: 14,
      facingsGap: 10,
      actionCount: 4,
      reviewPending: 0,
      reviewApproved: 0,
      reviewRejected: 0,
      retakeRequests: 0,
    })
  })

  test("aggregates the maximum query window within a bounded time", () => {
    const rows: ShelfAnalyticsRow[] = Array.from({ length: 10_000 }, (_, index) => ({
      status: index % 10 === 0 ? "UNAVAILABLE" : "PASS",
      structuralScore: index % 10 === 0 ? null : 80,
      visualConfidence: index % 10 === 0 ? null : 0.75,
      oosCount: 1,
      expectedFacings: 10,
      actualFacings: 8,
      actionCount: 2,
    }))
    const startedAt = performance.now()
    const result = buildShelfAnalytics(rows)
    const durationMs = performance.now() - startedAt
    expect(result).toMatchObject({ samples: 10_000, availableSamples: 9_000, oosCount: 10_000 })
    expect(durationMs).toBeLessThan(1_000)
  })
})
