import { describe, expect, it } from "vitest"
import { hasCompleteMobileCursorSet } from "./cursors"

describe("hasCompleteMobileCursorSet", () => {
  it("accepts an explicit null cursor for every collection", () => {
    expect(
      hasCompleteMobileCursorSet({
        tasks: null,
        planogramBundles: null,
        routes: null,
        visits: null,
        photoSubmissions: null,
      }),
    ).toBe(true)
  })

  it("requires stored cursors when any collection is omitted", () => {
    expect(
      hasCompleteMobileCursorSet({
        tasks: "tasks-cursor",
        planogramBundles: "bundle-cursor",
        routes: "routes-cursor",
        visits: "visits-cursor",
      }),
    ).toBe(false)
  })
})
