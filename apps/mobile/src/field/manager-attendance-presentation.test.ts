import { describe, expect, it } from "vitest"
import type { FieldManagerAttendanceScheduleStatus } from "./contracts"
import {
  MANAGER_ATTENDANCE_PRIMARY_SUMMARY,
  managerAttendanceStatusPresentation,
} from "./manager-attendance-presentation"

describe("manager attendance presentation", () => {
  it("maps every server status to translated text, an icon, and a non-colour cue", () => {
    const statuses: FieldManagerAttendanceScheduleStatus[] = [
      "FUTURE",
      "EXCUSED",
      "NOT_SCHEDULED",
      "AWAITING_START",
      "ON_TIME",
      "LATE",
      "ABSENT",
      "OPEN",
      "CLOSED",
      "UNCLOSED",
      "EARLY_FINISH",
      "SCHEDULE_UNRESOLVED",
      "DATA_CONFLICT",
    ]

    expect(statuses.map(managerAttendanceStatusPresentation)).toHaveLength(statuses.length)
    for (const status of statuses) {
      const presentation = managerAttendanceStatusPresentation(status)
      expect(presentation.labelKey).toBe(`managerAttendanceStatus_${status}`)
      expect(presentation.icon.length).toBeGreaterThan(0)
      expect(presentation.tone.length).toBeGreaterThan(0)
    }
  })

  it("keeps the requested transparent counts and never invents a discipline score", () => {
    expect(MANAGER_ATTENDANCE_PRIMARY_SUMMARY.map((item) => item.field)).toEqual([
      "onTimeDays",
      "lateDays",
      "absentDays",
      "unclosedDays",
      "earlyFinishDays",
      "excusedDays",
    ])
    expect(MANAGER_ATTENDANCE_PRIMARY_SUMMARY.some((item) => String(item.field).toLowerCase().includes("score"))).toBe(false)
  })
})
