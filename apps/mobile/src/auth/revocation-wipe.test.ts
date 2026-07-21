import { describe, expect, test, vi } from "vitest"
import { wipeRevokedSession } from "./revocation-wipe"

describe("remote revocation wipe", () => {
  test("deletes media, operational data and session in order", async () => {
    const calls: string[] = []
    const result = await wipeRevokedSession({
      deleteMedia: () => { calls.push("media") },
      purgeOperationalData: () => { calls.push("database") },
      clearSession: () => { calls.push("session") },
    })
    expect(calls).toEqual(["media", "database", "session"])
    expect(result.failures).toEqual([])
  })

  test("attempts every backend and reports failures without retaining auth", async () => {
    const clearSession = vi.fn()
    const result = await wipeRevokedSession({
      deleteMedia: () => { throw new Error("filesystem unavailable") },
      purgeOperationalData: () => { throw new Error("sqlite unavailable") },
      clearSession,
    })
    expect(clearSession).toHaveBeenCalledOnce()
    expect(result.failures).toEqual(["media", "database"])
  })
})
