import { describe, expect, it } from "vitest"
import { adjacentWeekStarts } from "./week-cache-window"

describe("field week cache window", () => {
  it("keeps exactly the previous and next calendar weeks around the foreground week", () => {
    expect(adjacentWeekStarts("2026-08-24")).toEqual(["2026-08-17", "2026-08-31"])
  })

  it("crosses a calendar year without relying on device locale", () => {
    expect(adjacentWeekStarts("2026-12-28")).toEqual(["2026-12-21", "2027-01-04"])
  })
})
