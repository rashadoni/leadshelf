import { describe, expect, it, vi } from "vitest"
import { consumeDurableRateLimit } from "./rate-limit"

describe("durable rate limiter", () => {
  it("allows requests through the configured maximum", async () => {
    const query = vi.fn(async () => [{ count: 2, expiresAt: new Date("2026-07-18T12:00:10Z") }])

    await expect(
      consumeDurableRateLimit(query, "sync", "opaque", { max: 2, windowMs: 10_000 }, new Date("2026-07-18T12:00:02Z")),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 })
  })

  it("blocks excess requests with a server-derived retry time", async () => {
    const query = vi.fn(async () => [{ count: 3, expiresAt: new Date("2026-07-18T12:00:10Z") }])

    await expect(
      consumeDurableRateLimit(query, "sync", "opaque", { max: 2, windowMs: 10_000 }, new Date("2026-07-18T12:00:02Z")),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 8 })
  })

  it("rejects invalid rules before touching the database", async () => {
    const query = vi.fn()
    await expect(
      consumeDurableRateLimit(query, "sync", "opaque", { max: 0, windowMs: 10_000 }),
    ).rejects.toThrow("invalid rate limit rule")
    expect(query).not.toHaveBeenCalled()
  })
})
