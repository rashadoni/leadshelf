import { describe, expect, it } from "vitest"
import { FixedWindowRateLimiter, opaqueRateLimitKey } from "./rate-limit"

describe("fixed-window rate limiter", () => {
  it("blocks above the limit and returns retry-after", () => {
    const limiter = new FixedWindowRateLimiter()
    const rule = { max: 2, windowMs: 10_000 }
    expect(limiter.consume("a", rule, 1_000).allowed).toBe(true)
    expect(limiter.consume("a", rule, 2_000).allowed).toBe(true)
    expect(limiter.consume("a", rule, 3_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 8,
    })
  })

  it("opens a fresh window after reset and isolates keys", () => {
    const limiter = new FixedWindowRateLimiter()
    const rule = { max: 1, windowMs: 1_000 }
    expect(limiter.consume("a", rule, 0).allowed).toBe(true)
    expect(limiter.consume("b", rule, 100).allowed).toBe(true)
    expect(limiter.consume("a", rule, 1_000).allowed).toBe(true)
  })

  it("creates stable opaque keys without exposing the source values", () => {
    const key = opaqueRateLimitKey(["tenant", "employee", "127.0.0.1"])
    expect(key).toHaveLength(64)
    expect(key).not.toContain("employee")
    expect(key).toBe(opaqueRateLimitKey(["tenant", "employee", "127.0.0.1"]))
  })
})
