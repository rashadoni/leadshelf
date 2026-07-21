import { describe, expect, it } from "vitest"
import { checkReadiness } from "./readiness"

describe("production readiness", () => {
  const now = () => new Date("2026-07-18T10:00:00.000Z")
  const up = async () => undefined

  it("reports ready only after every dependency check succeeds", async () => {
    const result = await checkReadiness({ configuration: up, database: up, objectStorage: up, now })
    expect(result).toMatchObject({
      status: "ready",
      checkedAt: "2026-07-18T10:00:00.000Z",
      checks: {
        configuration: { status: "up" },
        database: { status: "up" },
        objectStorage: { status: "up" },
      },
    })
  })

  it("returns a safe failure without leaking database error details", async () => {
    const result = await checkReadiness({
      configuration: up,
      database: async () => {
        throw new Error("password=must-not-leak host=private-db")
      },
      objectStorage: up,
      now,
    })
    expect(result).toMatchObject({
      status: "not_ready",
      checks: { database: { status: "down", error: "unavailable" } },
    })
    expect(JSON.stringify(result)).not.toContain("must-not-leak")
    expect(JSON.stringify(result)).not.toContain("private-db")
  })

  it("fails closed when a dependency exceeds its timeout", async () => {
    const result = await checkReadiness({
      configuration: up,
      database: () => new Promise(() => undefined),
      objectStorage: up,
      now,
      timeoutMs: 5,
    })
    expect(result).toMatchObject({
      status: "not_ready",
      checks: { database: { status: "down", error: "timeout" } },
    })
  })

  it("fails closed when object storage is unavailable", async () => {
    const result = await checkReadiness({
      configuration: up,
      database: up,
      objectStorage: async () => {
        throw new Error("S3_SECRET_KEY=must-not-leak")
      },
      now,
    })
    expect(result).toMatchObject({
      status: "not_ready",
      checks: {
        database: { status: "up" },
        objectStorage: { status: "down", error: "unavailable" },
      },
    })
    expect(JSON.stringify(result)).not.toContain("must-not-leak")
  })

  it("fails closed when an approved security policy is absent", async () => {
    const result = await checkReadiness({
      configuration: async () => { throw new Error("AUTH_LOCKOUT_MAX_FAILURES is absent") },
      database: up,
      objectStorage: up,
      now,
    })
    expect(result).toMatchObject({
      status: "not_ready",
      checks: { configuration: { status: "down", error: "unavailable" } },
    })
    expect(JSON.stringify(result)).not.toContain("AUTH_LOCKOUT")
  })
})
