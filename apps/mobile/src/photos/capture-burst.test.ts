import { describe, expect, it, vi } from "vitest"
import { captureBurstFrames } from "./capture-burst"

describe("captureBurstFrames", () => {
  it("captures the requested series", async () => {
    const capture = vi.fn(async (index: number) => `frame-${index}`)
    const result = await captureBurstFrames({ count: 3, capture })
    expect(result).toEqual({
      frames: [
        { value: "frame-0", index: 0 },
        { value: "frame-1", index: 1 },
        { value: "frame-2", index: 2 },
      ],
      failedCaptures: 0,
    })
  })

  it("falls back to one valid frame after a later camera failure", async () => {
    const capture = vi.fn(async (index: number) => {
      if (index === 1) throw new Error("camera busy")
      return `frame-${index}`
    })
    const result = await captureBurstFrames({ count: 3, capture })
    expect(result).toEqual({ frames: [{ value: "frame-0", index: 0 }], failedCaptures: 1 })
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it("continues after an initial failure so a single frame can recover", async () => {
    const capture = vi.fn(async (index: number) => {
      if (index === 0) throw new Error("not ready")
      return `frame-${index}`
    })
    const result = await captureBurstFrames({ count: 3, capture })
    expect(result.frames).toHaveLength(2)
    expect(result.failedCaptures).toBe(1)
  })

  it("normalizes invalid burst counts to one attempt", async () => {
    const capture = vi.fn(async () => "frame")
    await captureBurstFrames({ count: 0, capture })
    expect(capture).toHaveBeenCalledTimes(1)
  })
})
