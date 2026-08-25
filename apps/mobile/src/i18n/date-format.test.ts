import { describe, expect, it } from "vitest"
import {
  formatCalendarDate,
  formatCalendarDay,
  formatCalendarRange,
  formatLongCalendarDate,
  formatShortDateTime,
  formatTime,
  isSameLocalDay,
} from "./date-format"

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

  it("formats calendar labels without relying on Android Intl locale support", () => {
    expect(formatCalendarDay("2026-08-24", "az")).toEqual({
      day: "24",
      weekday: "bazar ertəsi",
      date: "24 avqust",
    })
    expect(formatCalendarDay("2026-08-24", "ru")).toEqual({
      day: "24",
      weekday: "понедельник",
      date: "24 августа",
    })
    expect(formatCalendarDate("2026-08-24", "az")).toBe("24 avqust 2026")
    expect(formatCalendarDate("2026-08-24", "ru")).toBe("24 августа 2026")
    expect(formatCalendarRange("2026-08-24", "2026-08-31", "az")).toBe("24 avqust — 30 avqust 2026")
    expect(formatCalendarRange("2026-12-28", "2027-01-04", "ru")).toBe("28 декабря 2026 — 3 января 2027")
    expect(formatLongCalendarDate("2026-08-24", "az")).toBe("bazar ertəsi, 24 avqust")
  })

  it("uses the tenant timezone when one is supplied", () => {
    const instant = "2026-08-24T20:15:00.000Z"
    expect(formatTime(instant, "Asia/Baku")).toBe("00:15")
    expect(formatShortDateTime(instant, "ru", "Asia/Baku")).toBe("25 августа, 00:15")
  })
})
