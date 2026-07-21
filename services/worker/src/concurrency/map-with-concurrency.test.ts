import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "./map-with-concurrency"

describe("mapWithConcurrency", () => {
  it("preserves result order and never exceeds the bound", async () => {
    let active = 0
    let maxActive = 0
    const results = await mapWithConcurrency([30, 5, 20, 1], 2, async (delay, index) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, delay))
      active--
      return index
    })

    expect(results).toEqual([0, 1, 2, 3])
    expect(maxActive).toBe(2)
  })

  it("rejects invalid bounds", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      "positive integer",
    )
  })
})
