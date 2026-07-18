import { describe, expect, it } from "vitest"
import { importQueueRetryPolicy, retryDelayMs } from "./retry-policy"

describe("catalog import retry policy", () => {
  it("uses bounded production-safe defaults for invalid configuration", () => {
    expect(importQueueRetryPolicy({
      LEADSHELF_IMPORT_QUEUE_MAX_ATTEMPTS: "0",
      LEADSHELF_IMPORT_QUEUE_RETRY_BASE_MS: "NaN",
      LEADSHELF_IMPORT_QUEUE_STALE_MS: "1000",
    })).toMatchObject({ maxAttempts: 3, baseDelayMs: 5_000, staleAfterMs: 30 * 60_000 })
  })

  it("applies capped exponential backoff", () => {
    const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 2_500, staleAfterMs: 60_000 }
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, policy))).toEqual([1_000, 2_000, 2_500, 2_500])
  })
})
