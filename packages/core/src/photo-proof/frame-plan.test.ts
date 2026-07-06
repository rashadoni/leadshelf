import { describe, expect, it } from "vitest"
import { selectProofVideoFrameTimestamps } from "./frame-plan.ts"

describe("proof video frame plan", () => {
  it("selects front, middle, and back frames for a guided proof video", () => {
    expect(selectProofVideoFrameTimestamps({ durationMs: 6_000 })).toEqual({
      timestampsMs: [900, 3_000, 5_100],
      strategy: "front_middle_back",
    })
  })

  it("falls back to one midpoint frame for very short videos", () => {
    expect(selectProofVideoFrameTimestamps({ durationMs: 1_200 })).toEqual({
      timestampsMs: [600],
      strategy: "single_midpoint",
    })
  })

  it("caps frame count for AI cost control", () => {
    const plan = selectProofVideoFrameTimestamps({ durationMs: 10_000, maxFrames: 2 })

    expect(plan.timestampsMs).toHaveLength(2)
    expect(plan.timestampsMs).toEqual([900, 5_000])
  })
})
