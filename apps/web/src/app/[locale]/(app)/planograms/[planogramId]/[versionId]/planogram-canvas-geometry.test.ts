import { describe, expect, test } from "vitest"
import { placementCanvasGeometry, planogramCanvasScale } from "./planogram-canvas-geometry"

const shelf = { id: "shelf-1", shelfIndex: 0, yMm: 100, thicknessMm: 20, depthMm: 300 }

function placement(overrides: Record<string, number> = {}) {
  return {
    id: "placement-1",
    shelfId: shelf.id,
    xMm: 50,
    widthMm: 80,
    heightMm: 120,
    depthMm: 40,
    facingsX: 3,
    facingsY: 2,
    facingsZ: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    stackMode: "NONE" as const,
    product: {
      id: "product-1",
      sku: "SKU-001",
      barcode: null,
      name: "Test product",
      brandName: null,
      imageKey: null,
    },
    ...overrides,
  }
}

describe("planogram canvas geometry", () => {
  test("fits a rack by both width and height before applying zoom", () => {
    expect(planogramCanvasScale({
      equipmentWidthMm: 1200,
      equipmentHeightMm: 1800,
      containerWidthPx: 800,
      zoom: 1,
    })).toBe(0.5)

    expect(planogramCanvasScale({
      equipmentWidthMm: 1200,
      equipmentHeightMm: 1800,
      containerWidthPx: 800,
      zoom: 2,
    })).toBe(1)
  })

  test("keeps one package cell size while facings repeat on X and Y", () => {
    const geometry = placementCanvasGeometry({
      equipmentHeightMm: 1800,
      scale: 0.5,
      shelf,
      placement: placement(),
    })

    expect(geometry.faceWidthPx).toBe(40)
    expect(geometry.faceHeightPx).toBe(60)
    expect(geometry.widthPx).toBe(120)
    expect(geometry.heightPx).toBe(120)
    expect(geometry.xPx).toBe(25)
    expect(geometry.yPx).toBe(720)
  })

  test("uses the oriented front face and compression without stretching a facing", () => {
    const geometry = placementCanvasGeometry({
      equipmentHeightMm: 1800,
      scale: 1,
      shelf,
      placement: placement({ rotationZ: 90, compressionX: 0.75, facingsX: 2, facingsY: 1 }),
    })

    expect(geometry.faceWidthPx).toBe(90)
    expect(geometry.faceHeightPx).toBe(80)
    expect(geometry.widthPx).toBe(180)
    expect(geometry.heightPx).toBe(80)
  })
})
