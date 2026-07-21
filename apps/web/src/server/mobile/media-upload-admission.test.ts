import { beforeEach, describe, expect, it, vi } from "vitest"

const { consumeRateLimit } = vi.hoisted(() => ({ consumeRateLimit: vi.fn() }))
vi.mock("@/server/security/rate-limit", () => ({ consumeRateLimit }))

import { acquireMediaUploadAdmission } from "./media-upload-admission"

describe("shared media upload admission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  })

  it("returns the durable limiter response before consuming process capacity", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 23 })

    const denied = await acquireMediaUploadAdmission(
      "mobile-upload",
      "device-1",
      { max: 30, windowMs: 600_000 },
    )

    expect(denied.ok).toBe(false)
    if (denied.ok) throw new Error("expected denied admission")
    expect(denied.response.status).toBe(429)
    expect(denied.response.headers.get("retry-after")).toBe("23")
    expect(await denied.response.json()).toEqual({ error: "rate_limited" })
  })

  it("enforces one aggregate bounded semaphore across upload consumers", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 33 }, (_, index) =>
        acquireMediaUploadAdmission(
          index % 2 === 0 ? "mobile-upload" : "catalog-image-upload",
          `consumer-${index}`,
          { max: 60, windowMs: 600_000 },
        ),
      ),
    )
    const permits = attempts.filter((permit) => permit.ok)
    const overloaded = attempts.find((permit) => !permit.ok)
    expect(permits.length).toBeGreaterThanOrEqual(1)
    expect(permits.length).toBeLessThanOrEqual(32)
    expect(overloaded).toBeDefined()
    if (!overloaded) throw new Error("expected exhausted admission")
    if (overloaded.ok) throw new Error("expected exhausted admission")
    expect(overloaded.response.status).toBe(503)
    expect(overloaded.response.headers.get("retry-after")).toBe("2")

    for (const permit of permits) {
      if (permit.ok) permit.release()
    }
    const recovered = await acquireMediaUploadAdmission(
      "mobile-upload",
      "device-recovered",
      { max: 30, windowMs: 600_000 },
    )
    expect(recovered.ok).toBe(true)
    if (recovered.ok) recovered.release()
  })
})
