import { t } from "../i18n"

/**
 * Server enums must never leak into the field-facing interface. Unknown
 * values deliberately receive a neutral translated label instead of the raw
 * code, which also makes schema additions safe for an older APK.
 */
export function objectTypeLabel(value: string | null | undefined): string {
  if (value === "PHARMACY") return t("objectType_PHARMACY")
  if (value === "CLINIC") return t("objectType_CLINIC")
  if (value === "DOCTOR") return t("objectType_DOCTOR")
  if (value === "STORE") return t("objectType_STORE")
  return t("objectType_OTHER")
}

export function contactTypeLabel(value: string | null | undefined): string {
  if (value === "DOCTOR") return t("contactType_DOCTOR")
  if (value === "PHARMACIST") return t("contactType_PHARMACIST")
  return t("contactType_OTHER")
}

export function agentRoleLabel(value: string | null | undefined): string {
  if (value === "ADMIN") return t("agentRole_ADMIN")
  if (value === "MANAGER") return t("agentRole_MANAGER")
  if (value === "SUPERVISOR") return t("agentRole_SUPERVISOR")
  if (value === "AGENT") return t("agentRole_AGENT")
  return t("lifecycleStatus_UNKNOWN")
}

export function assignmentRoleLabel(value: string | null | undefined): string {
  if (value === "PRIMARY") return t("assignmentRole_PRIMARY")
  if (value === "SECONDARY") return t("assignmentRole_SECONDARY")
  if (value === "OBSERVER") return t("assignmentRole_OBSERVER")
  if (value === "PARTICIPANT") return t("assignmentRole_PARTICIPANT")
  return t("lifecycleStatus_UNKNOWN")
}

export function lifecycleStatusLabel(value: string | null | undefined): string {
  if (value === "ACTIVE") return t("lifecycleStatus_ACTIVE")
  if (value === "INACTIVE") return t("lifecycleStatus_INACTIVE")
  if (value === "SUSPENDED") return t("lifecycleStatus_SUSPENDED")
  if (value === "PROSPECT") return t("lifecycleStatus_PROSPECT")
  if (value === "DUPLICATE") return t("lifecycleStatus_DUPLICATE")
  if (value === "MERGED") return t("lifecycleStatus_MERGED")
  return t("lifecycleStatus_UNKNOWN")
}

export function workdayStatusLabel(value: string | null | undefined): string {
  if (value === "STARTED") return t("workdayStatus_STARTED")
  if (value === "PAUSED") return t("workdayStatus_PAUSED")
  if (value === "COMPLETED") return t("workdayStatus_COMPLETED")
  return t("workdayStatus_NOT_STARTED")
}
