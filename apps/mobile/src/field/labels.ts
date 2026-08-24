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

export function agentTaskStatusLabel(value: string | null | undefined): string {
  if (value === "PENDING") return t("agentTaskStatus_PENDING")
  if (value === "IN_PROGRESS") return t("agentTaskStatus_IN_PROGRESS")
  if (value === "COMPLETED") return t("agentTaskStatus_COMPLETED")
  if (value === "CANCELLED") return t("agentTaskStatus_CANCELLED")
  if (value === "OVERDUE") return t("agentTaskStatus_OVERDUE")
  return t("lifecycleStatus_UNKNOWN")
}

export function hrmRequestTypeLabel(value: string | null | undefined): string {
  if (value === "LEAVE") return t("managerHrmType_LEAVE")
  if (value === "ABSENCE") return t("managerHrmType_ABSENCE")
  if (value === "TIME_CORRECTION") return t("managerHrmType_TIME_CORRECTION")
  return t("managerApprovalTypeUnknown")
}

export function routeChangeTypeLabel(value: string | null | undefined): string {
  if (value === "REMOVE_STOP") return t("managerRouteChange_REMOVE_STOP")
  if (value === "ADD_STOP") return t("managerRouteChange_ADD_STOP")
  if (value === "CONFLICT_OVERRIDE") return t("managerRouteChange_CONFLICT_OVERRIDE")
  return t("managerApprovalTypeUnknown")
}

export function contactChangeKindLabel(value: string | null | undefined): string {
  if (value === "CONTACT_UPDATE") return t("managerContactChange_CONTACT_UPDATE")
  if (value === "WORKPLACE_UPSERT") return t("managerContactChange_WORKPLACE_UPSERT")
  if (value === "WORKPLACE_END") return t("managerContactChange_WORKPLACE_END")
  if (value === "DUPLICATE_REPORT") return t("managerContactChange_DUPLICATE_REPORT")
  if (value === "DICTIONARY_ASSIGNMENTS") return t("managerContactChange_DICTIONARY_ASSIGNMENTS")
  return t("managerApprovalTypeUnknown")
}

/**
 * A visit photo has two independent lifecycles: the field sync queue and
 * the server review. The agent sees one actionable human label, never a
 * backend enum.
 */
export function visitPhotoStateLabel(
  status: string | null | undefined,
  syncState: "PENDING" | "CONFLICT" | "REJECTED" | null | undefined,
): string {
  if (syncState === "REJECTED" || status === "REJECTED") return t("fieldPhotoState_REJECTED")
  if (syncState === "CONFLICT") return t("fieldPhotoState_CONFLICT")
  if (syncState === "PENDING" || status === "LOCAL_PENDING") return t("fieldPhotoState_LOCAL_PENDING")
  if (status === "PENDING") return t("fieldPhotoState_PENDING")
  if (status === "APPROVED") return t("fieldPhotoState_APPROVED")
  return t("lifecycleStatus_UNKNOWN")
}

export function visitPhotoNeedsRetake(
  status: string | null | undefined,
  syncState: "PENDING" | "CONFLICT" | "REJECTED" | null | undefined,
): boolean {
  return status === "REJECTED" || syncState === "REJECTED" || syncState === "CONFLICT"
}
