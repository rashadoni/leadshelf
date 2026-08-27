import type { TabIconName } from "../components/TabIcon"
import type { MessageKey } from "../i18n"
import type {
  FieldManagerAttendanceScheduleStatus,
  FieldManagerAttendanceScheduleSummary,
} from "./contracts"

export type ManagerAttendanceTone = "success" | "warning" | "danger" | "info" | "neutral"

export interface ManagerAttendanceStatusPresentation {
  labelKey: MessageKey
  icon: TabIconName
  tone: ManagerAttendanceTone
}

export type ManagerAttendanceSummaryField = keyof Pick<
  FieldManagerAttendanceScheduleSummary,
  "onTimeDays" | "lateDays" | "absentDays" | "unclosedDays" | "earlyFinishDays" | "excusedDays"
>

/** The six evidence counts managers need at a glance. There is deliberately no score. */
export const MANAGER_ATTENDANCE_PRIMARY_SUMMARY: ReadonlyArray<{
  field: ManagerAttendanceSummaryField
  labelKey: MessageKey
  icon: TabIconName
  tone: ManagerAttendanceTone
}> = [
  { field: "onTimeDays", labelKey: "managerAttendanceOnTimeShort", icon: "check", tone: "success" },
  { field: "lateDays", labelKey: "managerAttendanceLateShort", icon: "alert", tone: "warning" },
  { field: "absentDays", labelKey: "managerAttendanceAbsentShort", icon: "close", tone: "danger" },
  { field: "unclosedDays", labelKey: "managerAttendanceUnclosedShort", icon: "stop", tone: "danger" },
  { field: "earlyFinishDays", labelKey: "managerAttendanceEarlyFinishShort", icon: "alert", tone: "warning" },
  { field: "excusedDays", labelKey: "managerAttendanceExcusedShort", icon: "check", tone: "info" },
]

export function managerAttendanceStatusPresentation(
  status: FieldManagerAttendanceScheduleStatus,
): ManagerAttendanceStatusPresentation {
  switch (status) {
    case "ON_TIME":
      return { labelKey: "managerAttendanceStatus_ON_TIME", icon: "check", tone: "success" }
    case "LATE":
      return { labelKey: "managerAttendanceStatus_LATE", icon: "alert", tone: "warning" }
    case "ABSENT":
      return { labelKey: "managerAttendanceStatus_ABSENT", icon: "close", tone: "danger" }
    case "UNCLOSED":
      return { labelKey: "managerAttendanceStatus_UNCLOSED", icon: "stop", tone: "danger" }
    case "EARLY_FINISH":
      return { labelKey: "managerAttendanceStatus_EARLY_FINISH", icon: "alert", tone: "warning" }
    case "EXCUSED":
      return { labelKey: "managerAttendanceStatus_EXCUSED", icon: "check", tone: "info" }
    case "AWAITING_START":
      return { labelKey: "managerAttendanceStatus_AWAITING_START", icon: "info", tone: "info" }
    case "OPEN":
      return { labelKey: "managerAttendanceStatus_OPEN", icon: "play", tone: "info" }
    case "CLOSED":
      return { labelKey: "managerAttendanceStatus_CLOSED", icon: "check", tone: "neutral" }
    case "NOT_SCHEDULED":
      return { labelKey: "managerAttendanceStatus_NOT_SCHEDULED", icon: "week", tone: "neutral" }
    case "FUTURE":
      return { labelKey: "managerAttendanceStatus_FUTURE", icon: "week", tone: "neutral" }
    case "SCHEDULE_UNRESOLVED":
      return { labelKey: "managerAttendanceStatus_SCHEDULE_UNRESOLVED", icon: "alert", tone: "warning" }
    case "DATA_CONFLICT":
      return { labelKey: "managerAttendanceStatus_DATA_CONFLICT", icon: "alert", tone: "warning" }
  }
}
