import { describe, expect, it } from "vitest"
import { formatShortDateTime, formatTime, isSameLocalDay } from "./date-format"

describe("offline date formatting", () => {
  it("uses local time rather than slicing a UTC timestamp", () => {
    const local = new Date(2026, 6, 10, 14, 5)
    expect(formatTime(local.toISOString())).toBe("14:05")
    expect(formatShortDateTime(local.toISOString(), "ru")).toBe("10 июля, 14:05")
    expect(formatShortDateTime(local.toISOString(), "az")).toBe("10 iyul, 14:05")
  })

  it("compares calendar days in the device timezone", () => {
    expect(isSameLocalDay(new Date(2026, 6, 10, 1), new Date(2026, 6, 10, 23))).toBe(true)
    expect(isSameLocalDay(new Date(2026, 6, 10, 23), new Date(2026, 6, 11, 1))).toBe(false)
  })
})
