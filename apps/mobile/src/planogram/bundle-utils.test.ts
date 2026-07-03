import { describe, expect, test } from "vitest"
import {
  findPlacementSummaryByCode,
  listChangeSummaries,
  listPlacementSummaries,
  placementTotalUnits,
} from "./bundle-utils"
import type { Bundle } from "./PlanogramSvg"

const bundle: Bundle = {
  equipment: [
    {
      widthMm: 1200,
      heightMm: 1800,
      shelves: [{ id: "s1", shelfIndex: 0, yMm: 100, thicknessMm: 20 }],
    },
  ],
  placements: [
    {
      id: "p1",
      shelfId: "s1",
      xMm: 0,
      widthMm: 75,
      heightMm: 150,
      depthMm: 60,
      facingsX: 4,
      facingsY: 2,
      facingsZ: 3,
      product: {
        sku: "SKU-1",
        name: "Pain Relief",
        brandName: "Acme",
        barcode: "123456",
      },
    },
  ],
}

describe("planogram bundle summaries", () => {
  test("counts total units across facings", () => {
    expect(placementTotalUnits(bundle.placements[0]!)).toBe(24)
  })

  test("builds mobile product detail rows from bundle placement", () => {
    expect(listPlacementSummaries(bundle)).toMatchObject([
      {
        placementId: "p1",
        sku: "SKU-1",
        name: "Pain Relief",
        brandName: "Acme",
        barcode: "123456",
        shelfLabel: "1",
        dimensionsLabel: "75x150x60 mm",
        facingsLabel: "4x2x3",
        totalUnits: 24,
      },
    ])
  })

  test("builds current changed-items fallback when bundle has no diff", () => {
    expect(listChangeSummaries(bundle)).toMatchObject([
      {
        kind: "current",
        sku: "SKU-1",
        name: "Pain Relief",
        detail: "4x2x3 · 24",
        placementId: "p1",
      },
    ])
  })

  test("finds a placement by normalized barcode", () => {
    const summaries = listPlacementSummaries(bundle)

    expect(findPlacementSummaryByCode(summaries, "123 456")?.placementId).toBe("p1")
  })

  test("finds a placement by SKU without case sensitivity", () => {
    const summaries = listPlacementSummaries(bundle)

    expect(findPlacementSummaryByCode(summaries, "sku-1")?.placementId).toBe("p1")
  })

  test("returns null for blank or unknown lookup codes", () => {
    const summaries = listPlacementSummaries(bundle)

    expect(findPlacementSummaryByCode(summaries, " ")).toBeNull()
    expect(findPlacementSummaryByCode(summaries, "missing")).toBeNull()
  })

  test("uses explicit changed-items payload when bundle provides diff", () => {
    expect(
      listChangeSummaries({
        ...bundle,
        changes: [
          {
            kind: "moved",
            placementId: "p1",
            product: { sku: "SKU-1", name: "Pain Relief" },
            fromShelfIndex: 0,
            toShelfIndex: 2,
          },
          {
            kind: "changed",
            sku: "SKU-2",
            name: "Cough Syrup",
            fromFacings: "2x1x1",
            toFacings: "3x1x2",
          },
        ],
      }),
    ).toMatchObject([
      {
        kind: "moved",
        sku: "SKU-1",
        name: "Pain Relief",
        detail: "1 -> 3",
        placementId: "p1",
      },
      {
        kind: "changed",
        sku: "SKU-2",
        name: "Cough Syrup",
        detail: "2x1x1 -> 3x1x2",
        placementId: null,
      },
    ])
  })
})
