import { describe, expect, it } from "vitest"
import {
  compareShelf,
  isValidShelfBBox,
  type ShelfExpectedPlacement,
  type ShelfObservedDetection,
} from "./compare.ts"

const bbox = { xPct: 10, yPct: 20, widthPct: 15, heightPct: 30 }

function placement(overrides: Partial<ShelfExpectedPlacement> = {}): ShelfExpectedPlacement {
  return {
    placementId: "placement-a",
    shelfId: "shelf-1",
    productId: "product-a",
    productSku: "SKU-A",
    productName: "Product A",
    brand: "Brand A",
    expectedFacings: 2,
    ...overrides,
  }
}

function detection(overrides: Partial<ShelfObservedDetection> = {}): ShelfObservedDetection {
  return {
    detectionId: "detection-a",
    placementId: "placement-a",
    shelfId: "shelf-1",
    productId: "product-a",
    productSku: "SKU-A",
    label: "Product A",
    brand: "Brand A",
    confidence: 0.94,
    facings: 2,
    bbox,
    ...overrides,
  }
}

describe("shelf comparison", () => {
  it("returns one deterministic result for a complete placement match", () => {
    const result = compareShelf({ expected: [placement()], detections: [detection()] })

    expect(result).toMatchObject({
      version: 1,
      status: "PASS",
      structuralScore: 100,
      visualConfidence: 0.94,
      placements: [{ outcome: "matched", expectedFacings: 2, actualFacings: 2, action: null }],
      metrics: { lenientCompliance: 100, strictCompliance: 100, expectedFacings: 2, actualFacings: 2 },
    })
    expect(result.actions).toEqual([])
  })

  it("sums duplicate detections by facings and creates an add action", () => {
    const result = compareShelf({
      expected: [placement({ expectedFacings: 4 })],
      detections: [
        detection({ detectionId: "detection-2", facings: 1 }),
        detection({ detectionId: "detection-1", facings: 2 }),
      ],
    })

    expect(result.placements[0]).toMatchObject({ outcome: "facing_mismatch", actualFacings: 3 })
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "add_facings", productSku: "SKU-A", amount: 1 }),
    ])
    expect(result.metrics.oos).toEqual([
      expect.objectContaining({ productSku: "SKU-A", expectedFacings: 4, actualFacings: 3, deficit: 1 }),
    ])
    expect(result.metrics.lenientCompliance).toBe(75)
  })

  it("keeps lenient and strict compliance separate when there is overstock", () => {
    const result = compareShelf({
      expected: [placement({ expectedFacings: 2 })],
      detections: [detection({ facings: 3 })],
      strictCompliance: true,
    })

    expect(result.metrics.lenientCompliance).toBe(100)
    expect(result.metrics.strictCompliance).toBe(50)
    expect(result.structuralScore).toBe(50)
    expect(result.status).toBe("FAIL")
    expect(result.actions[0]).toMatchObject({ type: "remove_facings", amount: 1 })
  })

  it("attaches an extra front detection to its unique shelf placement", () => {
    const result = compareShelf({
      expected: [placement({ expectedFacings: 1 })],
      detections: [
        detection({ detectionId: "detection-planned", facings: 1 }),
        detection({
          detectionId: "detection-extra-front",
          placementId: null,
          shelfId: "shelf-1",
          facings: 1,
        }),
      ],
    })

    expect(result.structuralScore).toBe(100)
    expect(result.status).toBe("REVIEW")
    expect(result.placements[0]).toMatchObject({ outcome: "facing_mismatch", actualFacings: 2 })
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "remove_facings", productSku: "SKU-A", amount: 1 }),
    ])
    expect(result.extras).toEqual([])
  })

  it("keeps an extra detection unresolved when the same SKU has multiple shelf placements", () => {
    const expected = [
      placement({ placementId: "placement-a", expectedFacings: 1, sortOrder: 1 }),
      placement({ placementId: "placement-b", expectedFacings: 1, sortOrder: 2 }),
    ]
    const result = compareShelf({
      expected,
      detections: [
        detection({ detectionId: "detection-a", placementId: "placement-a", facings: 1 }),
        detection({ detectionId: "detection-b", placementId: "placement-b", facings: 1 }),
        detection({ detectionId: "detection-ambiguous", placementId: null, facings: 1 }),
      ],
    })

    expect(result.status).toBe("REVIEW")
    expect(result.placements.map((item) => item.outcome)).toEqual(["matched", "matched"])
    expect(result.extras).toEqual([
      expect.objectContaining({ detectionId: "detection-ambiguous", productSku: "SKU-A" }),
    ])
    expect(result.warnings).toContain("ambiguous_placement:detection-ambiguous")
  })

  it("marks a product detected in an explicitly targeted foreign slot as wrong", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [
        detection({ productId: "product-b", productSku: "SKU-B", label: "Product B", facings: 1 }),
      ],
    })

    expect(result.placements[0]).toMatchObject({ outcome: "wrong_product", actualFacings: 0 })
    expect(result.actions[0]).toMatchObject({ type: "move", productSku: "SKU-A" })
    expect(result.extras).toEqual([])
  })

  it("reports a reciprocal product swap as two moves without a false out-of-stock", () => {
    const expected = [
      placement({ placementId: "p-mirinda", productId: "mirinda", productSku: "MIRINDA", sortOrder: 1 }),
      placement({ placementId: "p-saffir", productId: "saffir", productSku: "SAFFIR", sortOrder: 2 }),
    ]
    const detections = [
      detection({
        detectionId: "d-saffir",
        placementId: "p-mirinda",
        productId: "saffir",
        productSku: "SAFFIR",
        label: "Saffir",
      }),
      detection({
        detectionId: "d-mirinda",
        placementId: "p-saffir",
        productId: "mirinda",
        productSku: "MIRINDA",
        label: "Mirinda",
      }),
    ]

    const result = compareShelf({ expected, detections })

    expect(result.placements.map((item) => item.outcome)).toEqual(["wrong_product", "wrong_product"])
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "move", placementId: "p-mirinda", productSku: "MIRINDA" }),
      expect.objectContaining({ type: "move", placementId: "p-saffir", productSku: "SAFFIR" }),
    ])
    expect(result.metrics.oos).toEqual([])
  })

  it("creates a restock action when an expected product is absent", () => {
    const result = compareShelf({ expected: [placement({ expectedFacings: 3 })], detections: [] })

    expect(result.placements[0]).toMatchObject({ outcome: "missing", actualFacings: 0 })
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "restock", productSku: "SKU-A", amount: 3 }),
    ])
    expect(result.status).toBe("FAIL")
  })

  it("requires review when a missing SKU still leaves the score above the pass threshold", () => {
    const expected = Array.from({ length: 7 }, (_, index) =>
      placement({
        placementId: `placement-${index + 1}`,
        productId: `product-${index + 1}`,
        productSku: `SKU-${index + 1}`,
        productName: `Product ${index + 1}`,
        expectedFacings: 1,
        sortOrder: index + 1,
      }),
    )
    const detections = expected.slice(0, 6).map((expectedPlacement, index) =>
      detection({
        detectionId: `detection-${index + 1}`,
        placementId: expectedPlacement.placementId,
        productId: expectedPlacement.productId,
        productSku: expectedPlacement.productSku,
        label: expectedPlacement.productName,
        facings: 1,
      }),
    )

    const result = compareShelf({ expected, detections })

    expect(result.structuralScore).toBe(86)
    expect(result.status).toBe("REVIEW")
    expect(result.placements.at(-1)).toMatchObject({ outcome: "missing", productSku: "SKU-7" })
    expect(result.actions).toContainEqual(
      expect.objectContaining({ type: "restock", productSku: "SKU-7", amount: 1 }),
    )
  })

  it("does not collapse the same SKU across shelves and reports wrong position", () => {
    const result = compareShelf({
      expected: [
        placement({ placementId: "p-1", shelfId: "shelf-1", expectedFacings: 1, sortOrder: 1 }),
        placement({ placementId: "p-2", shelfId: "shelf-2", expectedFacings: 1, sortOrder: 2 }),
      ],
      detections: [
        detection({ detectionId: "d-1", placementId: null, shelfId: "shelf-1", facings: 1 }),
        detection({ detectionId: "d-2", placementId: null, shelfId: "shelf-1", facings: 1 }),
      ],
    })

    expect(result.placements).toHaveLength(2)
    expect(result.placements[0]).toMatchObject({ placementId: "p-1", outcome: "facing_mismatch", actualFacings: 2 })
    expect(result.placements[1]).toMatchObject({ placementId: "p-2", outcome: "wrong_position", actualFacings: 0 })
    expect(result.metrics.lenientCompliance).toBe(50)
    expect(result.metrics.strictCompliance).toBe(0)
  })

  it("uses slot-to-placement mapping without coupling to a provider", () => {
    const result = compareShelf({
      expected: [placement()],
      referenceSlots: [{ slotId: "slot-a", placementId: "placement-a" }],
      detections: [detection({ placementId: null, slotId: "slot-a" })],
    })

    expect(result.placements[0]).toMatchObject({ outcome: "matched", detectionIds: ["detection-a"] })
    expect(result.detections[0]?.placementId).toBe("placement-a")
  })

  it("turns low confidence into review instead of a false failure", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [detection({ confidence: 0.2 })],
    })

    expect(result.status).toBe("REVIEW")
    expect(result.warnings).toContain("low_confidence:detection-a")
    expect(result.actions).toEqual([expect.objectContaining({ type: "manual_review" })])
  })

  it("drops invalid spatial data without discarding the whole analysis", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [detection({ bbox: { xPct: 95, yPct: 20, widthPct: 10, heightPct: 10 } })],
    })

    expect(result.detections[0]?.bbox).toBeNull()
    expect(result.warnings).toContain("invalid_bbox:detection-a")
    expect(result.structuralScore).toBe(100)
    expect(result.visualConfidence).toBeNull()
    expect(result.status).toBe("REVIEW")
  })

  it("returns unavailable with null metrics instead of zero when analysis failed", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [],
      analysisAvailable: false,
    })

    expect(result.status).toBe("UNAVAILABLE")
    expect(result.structuralScore).toBeNull()
    expect(result.metrics.lenientCompliance).toBeNull()
    expect(result.metrics.strictCompliance).toBeNull()
    expect(result.metrics.oos).toEqual([])
    expect(result.placements[0]).toMatchObject({ outcome: "unavailable", actualFacings: null, action: null })
    expect(result.actions).toEqual([])
  })

  it("resolves a SKU-only detection to an expected product that has an id", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [detection({ productId: null })],
    })

    expect(result.structuralScore).toBe(100)
    expect(result.metrics.oos).toEqual([])
    expect(result.metrics.ourBrandSharePct).toBe(100)
  })

  it("treats a manual observation as usable even below the AI confidence threshold", () => {
    const result = compareShelf({
      expected: [placement()],
      detections: [detection({ source: "manual", confidence: 0.1 })],
    })

    expect(result.structuralScore).toBe(100)
    expect(result.warnings).toEqual([])
    expect(result.status).toBe("PASS")
  })

  it("returns unavailable for an empty expected planogram", () => {
    const result = compareShelf({ expected: [], detections: [detection({ placementId: null })] })

    expect(result.status).toBe("UNAVAILABLE")
    expect(result.structuralScore).toBeNull()
    expect(result.extras).toHaveLength(1)
  })

  it("uses largest remainder so shelf and brand shares sum to 100", () => {
    const expected = [
      placement({ placementId: "p-a", productId: "a", productSku: "A", brand: "Our", expectedFacings: 1 }),
      placement({ placementId: "p-b", productId: "b", productSku: "B", brand: "Our", expectedFacings: 1 }),
    ]
    const detections = [
      detection({ detectionId: "d-a", placementId: "p-a", productId: "a", productSku: "A", facings: 1 }),
      detection({ detectionId: "d-b", placementId: "p-b", productId: "b", productSku: "B", facings: 1 }),
      detection({ detectionId: "d-c", placementId: null, productId: "c", productSku: "C", brand: "Other", facings: 1 }),
    ]
    const result = compareShelf({ expected, detections })

    expect(result.metrics.shareOfShelf.map((row) => row.sharePct)).toEqual([34, 33, 33])
    expect(result.metrics.shareOfShelf.reduce((sum, row) => sum + row.sharePct, 0)).toBe(100)
    expect(result.metrics.ourBrandSharePct).toBe(67)
    expect(result.metrics.competitorSharePct).toBe(33)
    expect(result.metrics.brandShare.reduce((sum, row) => sum + row.sharePct, 0)).toBe(100)
  })

  it("is deterministic when expected placements and detections arrive in another order", () => {
    const expected = [
      placement({ placementId: "p-b", productId: "b", productSku: "B", sortOrder: 2 }),
      placement({ placementId: "p-a", productId: "a", productSku: "A", sortOrder: 1 }),
    ]
    const detections = [
      detection({ detectionId: "d-b", placementId: "p-b", productId: "b", productSku: "B" }),
      detection({ detectionId: "d-a", placementId: "p-a", productId: "a", productSku: "A" }),
    ]

    expect(compareShelf({ expected, detections })).toEqual(
      compareShelf({ expected: [...expected].reverse(), detections: [...detections].reverse() }),
    )
  })
})

describe("shelf bbox", () => {
  it("accepts only positive finite boxes inside the image", () => {
    expect(isValidShelfBBox(bbox)).toBe(true)
    expect(isValidShelfBBox({ xPct: 0, yPct: 0, widthPct: 0, heightPct: 1 })).toBe(false)
    expect(isValidShelfBBox({ xPct: 0, yPct: 0, widthPct: Number.NaN, heightPct: 1 })).toBe(false)
    expect(isValidShelfBBox({ xPct: 99, yPct: 0, widthPct: 2, heightPct: 1 })).toBe(false)
  })
})
