import { describe, expect, it } from "vitest"
import { routeStatusMeta, shiftDateKey, startOfIsoWeek } from "./week-status"

describe("mobile week status presentation", () => {
  it("keeps planned, active, completed, and missed routes visually distinct", () => {
    expect(new Set([
      routeStatusMeta("PLANNED").tone,
      routeStatusMeta("IN_PROGRESS").tone,
      routeStatusMeta("COMPLETED").tone,
      routeStatusMeta("MISSED").tone,
    ]).size).toBe(4)
  })

  it("moves by whole calendar weeks across month boundaries", () => {
    expect(shiftDateKey("2026-07-27", 7)).toBe("2026-08-03")
    expect(shiftDateKey("2026-08-03", -7)).toBe("2026-07-27")
  })

  it("normalizes any day to ISO Monday", () => {
    expect(startOfIsoWeek("2026-07-19")).toBe("2026-07-13")
  })
})
