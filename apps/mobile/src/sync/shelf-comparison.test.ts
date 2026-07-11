import { describe, expect, test } from "vitest"
import { mobilePhotoSubmissionRowSchema } from "@leadshelf/api-contracts/mobile/v1"

describe("mobile shelf comparison sync", () => {
  test("keeps legacy protocol-v1 photo rows valid when comparison is absent", () => {
    const row = mobilePhotoSubmissionRowSchema.parse({
      id: "photo-legacy",
      clientPhotoId: null,
      taskId: "task-1",
      storeId: "store-1",
      key: "photos/legacy.jpg",
      takenAt: "2026-07-11T08:00:00.000Z",
      qualityScore: null,
      review: null,
      vision: null,
      updatedAt: "2026-07-11T08:00:00.000Z",
    })
    expect(row.comparison).toBeUndefined()
  })

  test("accepts an additive canonical result without changing protocol v1", () => {
    const row = mobilePhotoSubmissionRowSchema.parse({
      id: "photo-1",
      clientPhotoId: "client-photo-1",
      taskId: "task-1",
      storeId: "store-1",
      key: "photos/proof.jpg",
      mediaType: "photo",
      takenAt: "2026-07-11T09:00:00.000Z",
      qualityScore: 0.9,
      review: null,
      vision: null,
      comparison: {
        version: 1,
        status: "UNAVAILABLE",
        structuralScore: null,
        visualConfidence: null,
        strictCompliance: false,
        placements: [],
        detections: [],
        extras: [],
        actions: [],
        metrics: {
          lenientCompliance: null,
          strictCompliance: null,
          expectedFacings: 0,
          actualFacings: null,
          oos: [],
          shareOfShelf: [],
          brandShare: [],
          ourBrandSharePct: null,
          competitorSharePct: null,
        },
        warnings: ["analysis_unavailable"],
      },
      updatedAt: "2026-07-11T09:01:00.000Z",
    })
    expect(row.comparison).toMatchObject({ status: "UNAVAILABLE", structuralScore: null })
  })
})
