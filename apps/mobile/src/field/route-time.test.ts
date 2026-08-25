import { describe, expect, it } from "vitest"
import {
  addMinutesToRouteTime,
  findRouteTimeConflicts,
  formatRouteTime,
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

  it("rejects malformed time and nonexistent DST wall time", () => {
    expect(isValidRouteTime("23:59")).toBe(true)
    expect(isValidRouteTime("24:00")).toBe(false)
    expect(routePlannedTime("2026-03-29", "02:30", "Europe/Berlin")).toBeNull()
  })

  it("supports week navigation and automatic intervals", () => {
    expect(shiftDateKey("2026-07-13", 7)).toBe("2026-07-20")
    expect(shiftDateKey("2026-01-01", -7)).toBe("2025-12-25")
    expect(addMinutesToRouteTime("09:00", 45)).toBe("09:45")
  })

  it("finds duplicate valid wall-clock times without treating blank or malformed inputs as collisions", () => {
    expect(findRouteTimeConflicts(["09:00", "", "09:00", "9:00", "11:30", "11:30"])).toEqual([
      { time: "09:00", indexes: [0, 2] },
      { time: "11:30", indexes: [4, 5] },
    ])
  })
})
