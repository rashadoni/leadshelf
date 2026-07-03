import { describe, expect, test } from "vitest"
import { listPlacementSummaries, placementTotalUnits } from "./bundle-utils"
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
})
