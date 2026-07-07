import { describe, expect, it } from "vitest"
import { evaluateShotExif, selectBestBurstShot } from "./burst-select"

describe("burst best-shot selection", () => {
  it("picks the largest file as the sharpest shot at equal capture settings", () => {
    const selection = selectBestBurstShot([
      { uri: "a.jpg", byteSize: 410_000 },
      { uri: "b.jpg", byteSize: 512_000 },
      { uri: "c.jpg", byteSize: 498_000 },
    ])
    expect(selection.bestIndex).toBe(1)
    expect(selection.issues).toEqual([])
  })

  it("prefers the earliest shot on ties and tolerates missing sizes", () => {
    expect(
      selectBestBurstShot([
        { uri: "a.jpg", byteSize: null },
        { uri: "b.jpg", byteSize: 300_000 },
        { uri: "c.jpg", byteSize: 300_000 },
      ]).bestIndex,
    ).toBe(1)
    expect(selectBestBurstShot([{ uri: "only.jpg", byteSize: null }]).bestIndex).toBe(0)
    expect(selectBestBurstShot([]).bestIndex).toBe(-1)
  })

  it("flags dark scenes from EXIF brightness", () => {
    const selection = selectBestBurstShot([
      { uri: "a.jpg", byteSize: 200_000, exif: { BrightnessValue: -2.4 } },
    ])
    expect(selection.issues).toContain("too_dark")
  })

  it("flags low light from high ISO with slow shutter", () => {
    expect(evaluateShotExif({ ISOSpeedRatings: 3200, ExposureTime: 1 / 10 })).toEqual(["low_light"])
    expect(evaluateShotExif({ ISOSpeedRatings: 3200, ExposureTime: 1 / 120 })).toEqual([])
    expect(evaluateShotExif({ ISOSpeedRatings: [3200], ExposureTime: 1 / 10 })).toEqual(["low_light"])
  })

  it("returns no issues without EXIF", () => {
    expect(evaluateShotExif(null)).toEqual([])
    expect(evaluateShotExif({})).toEqual([])
  })
})
