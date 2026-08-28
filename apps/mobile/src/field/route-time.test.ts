import { describe, expect, it } from "vitest"
import {
  addMinutesToRouteTime,
  dateKeyInTimezone,
  formatRouteTime,
  isChronologicalRouteTimeRange,
  isValidRouteTime,
  routePlannedTime,
  shiftDateKey,
} from "./route-time"

describe("field route wall-clock time", () => {
  it("converts Baku wall time to an absolute instant and back", () => {
    const planned = routePlannedTime("2026-07-15", "09:30", "Asia/Baku")
    expect(planned).toBe("2026-07-15T05:30:00.000Z")
    expect(formatRouteTime(planned, "Asia/Baku")).toBe("09:30")
  })

  it("uses the DST offset of the selected day", () => {
    expect(routePlannedTime("2026-01-15", "09:00", "Europe/Berlin")).toBe("2026-01-15T08:00:00.000Z")
    expect(routePlannedTime("2026-07-15", "09:00", "Europe/Berlin")).toBe("2026-07-15T07:00:00.000Z")
  })

  it("rejects malformed, nonexistent, and ambiguous DST wall time", () => {
    expect(isValidRouteTime("23:59")).toBe(true)
    expect(isValidRouteTime("24:00")).toBe(false)
    expect(routePlannedTime("2026-03-29", "02:30", "Europe/Berlin")).toBeNull()
    expect(routePlannedTime("2026-10-25", "02:30", "Europe/Berlin")).toBeNull()
  })

  it("supports week navigation and automatic intervals", () => {
    expect(shiftDateKey("2026-07-13", 7)).toBe("2026-07-20")
    expect(shiftDateKey("2026-01-01", -7)).toBe("2025-12-25")
    expect(addMinutesToRouteTime("09:00", 45)).toBe("09:45")
  })

  it("derives calendar keys in the organization timezone", () => {
    const instant = new Date("2026-08-27T21:30:00.000Z")
    expect(dateKeyInTimezone(instant, "Asia/Baku")).toBe("2026-08-28")
    expect(dateKeyInTimezone(instant, "America/New_York")).toBe("2026-08-27")
  })

  it("accepts only a complete forward time-correction range", () => {
    const start = routePlannedTime("2026-08-28", "09:00", "Asia/Baku")
    const end = routePlannedTime("2026-08-28", "18:00", "Asia/Baku")
    expect(isChronologicalRouteTimeRange(start, end)).toBe(true)
    expect(isChronologicalRouteTimeRange(end, start)).toBe(false)
    expect(isChronologicalRouteTimeRange(start, start)).toBe(false)
    expect(isChronologicalRouteTimeRange(start, null)).toBe(false)
  })
})
