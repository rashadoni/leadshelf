import { describe, expect, it } from "vitest"
import { planAutoPlacementInZone } from "./auto-placement"

const equipment = {
  widthMm: 1000,
  heightMm: 1200,
  depthMm: 400,
  shelves: [
    { id: "s1", shelfIndex: 0, yMm: 0, thicknessMm: 20, depthMm: 350 },
    { id: "s2", shelfIndex: 1, yMm: 500, thicknessMm: 20, depthMm: 350 },
  ],
}

describe("planAutoPlacementInZone", () => {
  it("places scored products inside the zone and assigns more facings to stronger products", () => {
    const result = planAutoPlacementInZone({
      equipment,
      zone: { id: "z1", xMm: 100, yMm: 0, widthMm: 800, heightMm: 700 },
      existing: [],
      products: [
        { id: "a", widthMm: 100, heightMm: 180, depthMm: 120, score: 100 },
        { id: "b", widthMm: 100, heightMm: 180, depthMm: 120, score: 40 },
      ],
    })

    expect(result.rejected).toHaveLength(0)
    expect(result.placements.map((placement) => placement.productId)).toEqual(["a", "b"])
    expect(result.placements[0]?.xMm).toBe(100)
    expect(result.placements[0]?.facingsX).toBe(3)
    expect(result.placements[1]?.facingsX).toBe(2)
  })

  it("rejects products that cannot fit without crossing existing placements", () => {
    const result = planAutoPlacementInZone({
      equipment,
      zone: { id: "z1", xMm: 0, yMm: 0, widthMm: 300, heightMm: 100 },
      existing: [
        {
          id: "existing",
          shelfId: "s1",
          xMm: 0,
          widthMm: 250,
          heightMm: 100,
          depthMm: 100,
          facingsX: 1,
          facingsY: 1,
          facingsZ: 1,
        },
      ],
      products: [{ id: "a", widthMm: 100, heightMm: 100, depthMm: 100, score: 1 }],
    })

    expect(result.placements).toHaveLength(0)
    expect(result.rejected).toEqual([{ productId: "a", reason: "no free physical slot inside zone" }])
  })

  it("compresses only soft-pack products when that is required to fit", () => {
    const result = planAutoPlacementInZone({
      equipment,
      zone: { id: "z1", xMm: 0, yMm: 0, widthMm: 270, heightMm: 100 },
      existing: [],
      products: [
        { id: "soft", widthMm: 100, heightMm: 100, depthMm: 100, score: 100, isSoftPack: true },
        { id: "rigid", widthMm: 100, heightMm: 100, depthMm: 100, score: 100 },
      ],
    })

    expect(result.placements).toMatchObject([
      { productId: "soft", facingsX: 3, compressionX: 0.9 },
    ])
    expect(result.placements[0]?.reason).toContain("compressionX=0.9")
    expect(result.rejected).toEqual([{ productId: "rigid", reason: "no free physical slot inside zone" }])
  })
})
