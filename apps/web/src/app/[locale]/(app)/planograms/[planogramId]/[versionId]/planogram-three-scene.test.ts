import { describe, expect, it } from "vitest"

import { buildPlanogramThreeSceneModel, mm, type ThreeViewerPlacement } from "./planogram-three-scene"

const equipment = {
  widthMm: 1000,
  heightMm: 2000,
  depthMm: 500,
  shelves: [
    { id: "shelf-a", shelfIndex: 0, yMm: 100, widthMm: 1000, depthMm: 450, thicknessMm: 20 },
    { id: "shelf-b", shelfIndex: 1, yMm: 600, widthMm: 1000, depthMm: 450, thicknessMm: 20 },
  ],
}

function placement(overrides: Partial<ThreeViewerPlacement>): ThreeViewerPlacement {
  return {
    id: "placement-a",
    shelfId: "shelf-a",
    xMm: 100,
    widthMm: 50,
    heightMm: 100,
    depthMm: 40,
    facingsX: 2,
    facingsY: 3,
    facingsZ: 1,
    product: { sku: "SKU-A", name: "Product A" },
    ...overrides,
  }
}

describe("planogram three scene model", () => {
  it("converts millimeters to meters", () => {
    expect(mm(1250)).toBe(1.25)
  })

  it("builds equipment, shelf, and product geometry from planogram placement data", () => {
    const model = buildPlanogramThreeSceneModel(equipment, [
      placement({ id: "placement-a", compressionX: 0.8 }),
      placement({ id: "placement-missing", shelfId: "missing-shelf" }),
    ])

    expect(model.equipmentWidth).toBe(1)
    expect(model.equipmentHeight).toBe(2)
    expect(model.equipmentDepth).toBe(0.5)
    expect(model.cameraPosition).toEqual({ x: 1.08, y: 1.44, z: 1.8 })
    expect(model.controlTarget).toEqual({ x: 0, y: 0.9, z: 0 })
    expect(model.floor).toEqual({
      width: 1.08,
      height: 0.018,
      depth: 0.64,
      position: { x: 0, y: -0.018, z: 0 },
    })
    expect(model.posts).toEqual([
      { width: 0.028, height: 2, depth: 0.028, position: { x: -0.5, y: 1, z: -0.25 } },
      { width: 0.028, height: 2, depth: 0.028, position: { x: 0.5, y: 1, z: -0.25 } },
    ])
    expect(model.shelves[0]).toEqual({
      id: "shelf-a",
      width: 1,
      height: 0.02,
      depth: 0.45,
      position: { x: 0, y: 0.11, z: 0 },
    })
    expect(model.products).toHaveLength(1)
    expect(model.products[0]).toMatchObject({
      id: "placement-a",
      sku: "SKU-A",
      width: 0.08,
      height: 0.3,
      depth: 0.04,
    })
    expect(model.products[0]?.position.x).toBeCloseTo(-0.36)
    expect(model.products[0]?.position.y).toBeCloseTo(0.27)
    expect(model.products[0]?.position.z).toBeCloseTo(0.23)
  })

  it("uses the same oriented placement width as the 2D shelf view", () => {
    const model = buildPlanogramThreeSceneModel(equipment, [
      placement({
        id: "rotated",
        widthMm: 80,
        heightMm: 120,
        depthMm: 35,
        facingsX: 3,
        facingsY: 2,
        facingsZ: 2,
        rotationY: 90,
        compressionX: 0.75,
      }),
    ])

    expect(model.products).toHaveLength(1)
    expect(model.products[0]).toMatchObject({
      id: "rotated",
      width: 0.07875,
      height: 0.24,
      depth: 0.16,
    })
    expect(model.products[0]?.position.x).toBeCloseTo(-0.360625)
    expect(model.products[0]?.position.z).toBeCloseTo(0.17)
  })
})
