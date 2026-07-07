import { describe, expect, it } from "vitest"
import {
  buildEquipmentSilhouette,
  buildTelemetryPayload,
  computeTilt,
  evaluateTilt,
} from "./capture-guide"

describe("capture guide tilt", () => {
  it("treats an upright portrait phone as level on both platforms", () => {
    // iOS: гравитация y ~ -1; Android: y ~ +1 — гейт по модулю не зависит от знака.
    const ios = computeTilt({ x: 0, y: -1, z: 0 })
    const android = computeTilt({ x: 0.02, y: 0.99, z: 0.03 })
    expect(evaluateTilt(ios, 6).level).toBe(true)
    expect(evaluateTilt(android, 6).level).toBe(true)
  })

  it("detects roll beyond tolerance", () => {
    // ~17° крена в плоскости экрана
    const tilted = computeTilt({ x: 0.3, y: -0.95, z: 0 })
    const evaluation = evaluateTilt(tilted, 6)
    expect(evaluation.level).toBe(false)
    expect(evaluation.offAxisDeg).toBeGreaterThan(10)
  })

  it("detects forward pitch beyond tolerance", () => {
    // телефон завален вперед: гравитация уходит в z
    const tilted = computeTilt({ x: 0, y: -0.8, z: 0.6 })
    expect(evaluateTilt(tilted, 6).level).toBe(false)
  })
})

describe("equipment silhouette", () => {
  it("builds aspect and shelf fractions from mm geometry", () => {
    const silhouette = buildEquipmentSilhouette({
      widthMm: 1200,
      heightMm: 1800,
      shelves: [{ yMm: 180 }, { yMm: 900 }, { yMm: 1460 }],
    })
    expect(silhouette).not.toBeNull()
    expect(silhouette!.aspect).toBeCloseTo(1200 / 1800)
    // доли от верха, отсортированы сверху вниз
    expect(silhouette!.shelfFractions.map((f) => Math.round(f * 100))).toEqual([19, 50, 90])
  })

  it("returns null for missing or degenerate geometry", () => {
    expect(buildEquipmentSilhouette(null)).toBeNull()
    expect(buildEquipmentSilhouette({ widthMm: 0, heightMm: 1800 })).toBeNull()
  })

  it("drops shelves outside the body", () => {
    const silhouette = buildEquipmentSilhouette({
      widthMm: 1000,
      heightMm: 1000,
      shelves: [{ yMm: 0 }, { yMm: 500 }, { yMm: 1000 }],
    })
    expect(silhouette!.shelfFractions).toEqual([0.5])
  })
})

describe("capture telemetry", () => {
  it("serializes time-to-accepted and retakes", () => {
    expect(
      buildTelemetryPayload({
        stepId: "front",
        openedAt: 1_000,
        acceptedAt: 9_500,
        retakes: 2,
        manualOverride: true,
        gyroAvailable: false,
        issues: ["too_dark"],
      }),
    ).toEqual({
      stepId: "front",
      timeToAcceptedMs: 8_500,
      retakes: 2,
      manualOverride: true,
      gyroAvailable: false,
      issues: ["too_dark"],
    })
  })
})
