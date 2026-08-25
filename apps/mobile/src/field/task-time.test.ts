import { describe, expect, it } from "vitest"
import {
  fieldTaskDateOptions,
  fieldTaskDueDateTime,
  isFieldTaskDueOnDate,
  resolveFieldTaskToday,
  shiftFieldTaskDueDate,
} from "./task-time"

describe("field task tenant calendar", () => {
  const timeZone = "Asia/Baku"
  const now = new Date("2026-08-24T20:15:00.000Z")

  it("uses the tenant day and not the device day for the task picker", () => {
    const today = resolveFieldTaskToday(null, timeZone, now)
    expect(today).toBe("2026-08-25")
    expect(fieldTaskDateOptions(today, 2)).toEqual([
      { key: "2026-08-25", day: "25", month: "08" },
      { key: "2026-08-26", day: "26", month: "08" },
    ])
  })

  it("matches and creates task due times in the tenant timezone", () => {
    const dueAt = fieldTaskDueDateTime("2026-08-25", "09:00", timeZone)
    expect(dueAt).toBe("2026-08-25T05:00:00.000Z")
    expect(isFieldTaskDueOnDate(dueAt, "2026-08-25", timeZone)).toBe(true)
  })

  it("keeps the tenant wall-clock due time when moving a task", () => {
    expect(shiftFieldTaskDueDate("2026-08-24T20:30:00.000Z", 1, "2026-08-25", timeZone))
      .toBe("2026-08-25T20:30:00.000Z")
  })
})
