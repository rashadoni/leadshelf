import { describe, expect, it } from "vitest"
import {
  findAvailableFloorPlanPosition,
  getRotatedFootprint,
  normalizeQuarterTurn,
  placementsOverlap,
  snapFloorPlanCoordinate,
  validateFloorPlanLayout,
} from "./geometry.ts"

describe("floor plan geometry", () => {
  it("normalizes rotations and swaps the occupied footprint for quarter turns", () => {
    expect(normalizeQuarterTurn(-90)).toBe(270)
    expect(normalizeQuarterTurn(450)).toBe(90)
    expect(getRotatedFootprint(1200, 400, 90)).toEqual({ widthMm: 400, depthMm: 1200 })
    expect(getRotatedFootprint(1200, 400, 180)).toEqual({ widthMm: 1200, depthMm: 400 })
  })

  it("snaps coordinates to the configured grid", () => {
    expect(snapFloorPlanCoordinate(149)).toBe(100)
    expect(snapFloorPlanCoordinate(151)).toBe(200)
    expect(snapFloorPlanCoordinate(-20)).toBe(0)
  })

  it("allows touching edges but detects an actual overlap", () => {
    const first = { xMm: 0, yMm: 0, widthMm: 1200, depthMm: 400, rotationDeg: 0 }
    expect(placementsOverlap(first, { ...first, xMm: 1200 })).toBe(false)
    expect(placementsOverlap(first, { ...first, xMm: 1100 })).toBe(true)
  })

  it("checks rotated bounds and reports conflicting item indexes", () => {
    const issues = validateFloorPlanLayout(
      { widthMm: 2000, depthMm: 1600 },
      [
        { xMm: 100, yMm: 100, widthMm: 1200, depthMm: 400, rotationDeg: 90 },
        { xMm: 300, yMm: 500, widthMm: 800, depthMm: 400, rotationDeg: 0 },
        { xMm: 1800, yMm: 0, widthMm: 1200, depthMm: 400, rotationDeg: 90 },
      ],
    )
    expect(issues).toContainEqual({ type: "collision", index: 0, conflictingIndex: 1 })
    expect(issues).toContainEqual({ type: "outside_bounds", index: 2 })
  })

  it("finds the next free snapped position instead of stacking new equipment at zero", () => {
    const placement = { widthMm: 1000, depthMm: 500, rotationDeg: 0 }
    const position = findAvailableFloorPlanPosition(
      { widthMm: 3000, depthMm: 2000 },
      placement,
      [{ ...placement, xMm: 0, yMm: 0 }],
      100,
    )
    expect(position).toEqual({ xMm: 1000, yMm: 0 })
  })
})
