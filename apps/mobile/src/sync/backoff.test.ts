import { describe, expect, it } from "vitest"
import { nextBackoffMs } from "./backoff"

describe("sync backoff", () => {
  it("grows exponentially from the base delay", () => {
    expect(nextBackoffMs(0)).toBe(0)
    expect(nextBackoffMs(1)).toBe(5_000)
    expect(nextBackoffMs(2)).toBe(10_000)
    expect(nextBackoffMs(3)).toBe(20_000)
    expect(nextBackoffMs(4)).toBe(40_000)
  })

  it("caps the delay", () => {
    expect(nextBackoffMs(100)).toBe(5 * 60_000)
  })

  it("honours custom options", () => {
    expect(nextBackoffMs(1, { baseMs: 1_000, factor: 3, capMs: 50_000 })).toBe(1_000)
    expect(nextBackoffMs(3, { baseMs: 1_000, factor: 3, capMs: 50_000 })).toBe(9_000)
    expect(nextBackoffMs(10, { baseMs: 1_000, factor: 3, capMs: 50_000 })).toBe(50_000)
  })
})
