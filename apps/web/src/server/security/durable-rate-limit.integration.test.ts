import { afterAll, describe, expect, it } from "vitest"
import { workerDb } from "@/server/db/client"
import { consumeRateLimit, opaqueRateLimitKey } from "./rate-limit"

const scope = `test-${process.pid}`
const key = "parallel-device"
const keyHash = opaqueRateLimitKey([key])

afterAll(async () => {
  await workerDb.rateLimitBucket.deleteMany({ where: { scope } })
})

describe("durable rate limiter integration", () => {
  it("serializes concurrent consumers across a shared PostgreSQL bucket", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeRateLimit(scope, key, { max: 5, windowMs: 60_000 }),
      ),
    )

    expect(results.filter((result) => result.allowed)).toHaveLength(5)
    expect(results.filter((result) => !result.allowed)).toHaveLength(7)
    const bucket = await workerDb.rateLimitBucket.findUnique({
      where: { scope_keyHash: { scope, keyHash } },
    })
    expect(bucket?.count).toBe(12)
  })
})
