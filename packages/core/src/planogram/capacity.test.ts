import { test } from "vitest"
import assert from "node:assert/strict"
import {
  maxFacingsX,
  orientedProductSizeMm,
  placementWidthMm,
  placementsOverlapX,
  shelfCapacity,
} from "./capacity.ts"

const shelf = { innerWidthMm: 1200, depthMm: 300, clearanceHeightMm: 350 }

test("maxFacingsX: 1200mm shelf fits 16 x 75mm products", () => {
  assert.equal(maxFacingsX(shelf, { widthMm: 75, heightMm: 150, depthMm: 60 }), 16)
})

test("maxFacingsX respects gap", () => {
  // (1200 + 5) / (75 + 5) = 15.06 -> 15
  assert.equal(maxFacingsX(shelf, { widthMm: 75, heightMm: 150, depthMm: 60 }, 5), 15)
})

test("shelfCapacity: full XYZ capacity", () => {
  const r = shelfCapacity(shelf, { widthMm: 75, heightMm: 150, depthMm: 60 })
  assert.deepEqual(r, { facingsX: 16, facingsY: 2, facingsZ: 5, totalUnits: 160, fits: true })
})

test("shelfCapacity: too tall product does not fit", () => {
  const r = shelfCapacity(shelf, { widthMm: 75, heightMm: 400, depthMm: 60 })
  assert.equal(r.fits, false)
  assert.equal(r.totalUnits, 0)
})

test("placementWidthMm includes inter-facing gaps", () => {
  assert.equal(placementWidthMm({ xMm: 0, widthMm: 100, facingsX: 3, gapMm: 10 }), 320)
  assert.equal(placementWidthMm({ xMm: 0, widthMm: 100, facingsX: 3, compressionX: 0.9 }), 270)
})

test("orientation uses 90 degree bounding-box rotations", () => {
  assert.deepEqual(
    orientedProductSizeMm({ widthMm: 100, heightMm: 200, depthMm: 300, rotationY: 90 }),
    { widthMm: 300, heightMm: 200, depthMm: 100, rotationY: 90 },
  )
  assert.equal(
    placementWidthMm({
      xMm: 0,
      widthMm: 100,
      heightMm: 200,
      depthMm: 300,
      facingsX: 2,
      rotationY: 90,
    }),
    600,
  )
})

test("placementsOverlapX detects collision and adjacency", () => {
  const a = { xMm: 0, widthMm: 100, facingsX: 2 } // [0, 200)
  assert.equal(placementsOverlapX(a, { xMm: 150, widthMm: 100, facingsX: 1 }), true)
  assert.equal(placementsOverlapX(a, { xMm: 200, widthMm: 100, facingsX: 1 }), false)
})
