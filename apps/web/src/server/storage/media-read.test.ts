import { describe, expect, it } from "vitest"
import { safeMediaRead } from "./media-read"

describe("privacy-safe media reads", () => {
  it("distinguishes available, missing and unavailable without retaining private errors", async () => {
    await expect(safeMediaRead("safe-key", async () => ({ body: "ok" })))
      .resolves.toEqual({ status: "available", object: { body: "ok" } })
    await expect(safeMediaRead("missing-key", async () => null))
      .resolves.toEqual({ status: "missing" })

    const result = await safeMediaRead("private/object/key", async () => {
      throw new Error("InvalidAccessKeyId bucket=private-bucket key=private/object/key secret=must-not-leak")
    })
    expect(result).toEqual({ status: "unavailable" })
    expect(JSON.stringify(result)).not.toMatch(/private|InvalidAccessKeyId|must-not-leak/)
  })
})
