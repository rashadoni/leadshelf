import { describe, expect, it } from "vitest"
import { buildReviewShelfComparison, type ReviewComparisonPlacementInput } from "./shelf-comparison.ts"

function placement(overrides: Partial<ReviewComparisonPlacementInput> = {}): ReviewComparisonPlacementInput {
  return {
    id: "placement-a",
    shelfId: "shelf-1",
    facingsX: 2,
    facingsY: 1,
    sortOrder: 0,
    product: {
      id: "product-a",
      sku: "SKU-A",
      name: "Product A",
      brand: { name: "Brand A" },
    },
    ...overrides,
  }
}

describe("review shelf comparison adapter", () => {
  it("prefers the canonical analysis run over legacy review findings", () => {
    const canonical = buildReviewShelfComparison({
      analysisStatus: "COMPLETED",
      placements: [placement()],
      referenceSlots: [],
      findings: { vision: { detections: [] } },
    })!
    const result = buildReviewShelfComparison({
      canonicalResult: canonical,
      analysisStatus: "FAILED",
      placements: [],
      referenceSlots: [],
      findings: null,
    })
    expect(result).toBe(canonical)
    expect(result?.status).toBe("FAIL")
  })

  it("maps the current review findings shape into the shared comparison engine", () => {
    const result = buildReviewShelfComparison({
      analysisStatus: "COMPLETED",
      placements: [placement()],
      referenceSlots: [{ id: "slot-a", placementId: "placement-a" }],
      findings: {
        vision: {
          detections: [
            {
              slotId: "slot-a",
              productId: "product-a",
              productSku: "SKU-A",
              label: "Product A",
              confidence: 0.92,
              facings: 2,
              bbox: { xPct: 10, yPct: 20, widthPct: 15, heightPct: 30 },
            },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      status: "PASS",
      structuralScore: 100,
      placements: [{ placementId: "placement-a", outcome: "matched", actualFacings: 2 }],
      detections: [{ placementId: "placement-a", bbox: { xPct: 10 } }],
    })
  })

  it("uses visible X by Y facings and does not include depth", () => {
    const result = buildReviewShelfComparison({
      analysisStatus: "COMPLETED",
      placements: [placement({ facingsX: 3, facingsY: 2 })],
      referenceSlots: [],
      findings: { vision: { detections: [] } },
    })

    expect(result?.placements[0]?.expectedFacings).toBe(6)
    expect(result?.metrics.expectedFacings).toBe(6)
  })

  it("returns unavailable without false actions after a failed analysis", () => {
    const result = buildReviewShelfComparison({
      analysisStatus: "FAILED",
      placements: [placement()],
      referenceSlots: [],
      findings: {},
    })

    expect(result).toMatchObject({ status: "UNAVAILABLE", structuralScore: null, actions: [] })
    expect(result?.placements[0]).toMatchObject({ outcome: "unavailable", actualFacings: null })
  })

  it("keeps malformed bbox as a review warning instead of failing parsing", () => {
    const result = buildReviewShelfComparison({
      analysisStatus: "COMPLETED",
      placements: [placement()],
      referenceSlots: [{ id: "slot-a", placementId: "placement-a" }],
      findings: {
        vision: {
          detections: [
            {
              slotId: "slot-a",
              productSku: "SKU-A",
              confidence: 0.9,
              facings: 2,
              bbox: { xPct: 95, yPct: 0, widthPct: 10, heightPct: 20 },
            },
          ],
        },
      },
    })

    expect(result?.status).toBe("REVIEW")
    expect(result?.warnings).toContain("invalid_bbox:slot-a")
    expect(result?.detections[0]?.bbox).toBeNull()
  })

  it("does not fabricate a comparison without planogram placements", () => {
    expect(
      buildReviewShelfComparison({
        analysisStatus: "COMPLETED",
        placements: [],
        referenceSlots: [],
        findings: { vision: { detections: [] } },
      }),
    ).toBeNull()
  })
})
