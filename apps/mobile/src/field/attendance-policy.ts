import type { MessageKey } from "../i18n"
import {
  FIELD_ATTENDANCE_POLICY_DEFAULT,
  type FieldAttendancePolicy,
} from "./contracts"

export type FieldAttendancePolicyPresentation = {
  policy: FieldAttendancePolicy
  requiresQrBeforeStart: boolean
  capturesEventGps: boolean
  runsContinuousTracking: boolean
  usesGps: boolean
  evidenceKey: MessageKey
  hintKey: MessageKey
  privacyBodyKey: MessageKey
}

/**
 * One policy translation for every field surface.  In particular, a tenant
 * that has not yet supplied policy data remains privacy-first rather than
 * being presented as if GPS tracking were active.
 */
export function presentFieldAttendancePolicy(
  policy: FieldAttendancePolicy | null | undefined,
): FieldAttendancePolicyPresentation {
  const resolved: FieldAttendancePolicy = policy ?? FIELD_ATTENDANCE_POLICY_DEFAULT
  const requiresQrBeforeStart = resolved.clockEvidence === "QR"
  const capturesEventGps = resolved.clockEvidence === "GPS"
  const runsContinuousTracking = (
    resolved.continuousTracking === "ACTIVE_WORKDAY" && !requiresQrBeforeStart
  )
  const usesGps = capturesEventGps || runsContinuousTracking

  return {
    policy: resolved,
    requiresQrBeforeStart,
    capturesEventGps,
    runsContinuousTracking,
    usesGps,
    evidenceKey: requiresQrBeforeStart
      ? "workdayEvidence_QR"
      : usesGps
        ? "workdayEvidence_GPS"
        : "workdayEvidence_NONE",
    hintKey: requiresQrBeforeStart
      ? "workdayPolicyQrPending"
      : runsContinuousTracking
        ? "workdayPolicyContinuousGps"
        : capturesEventGps
          ? "workdayPolicyEventGps"
          : "workdayPolicyNoLocation",
    privacyBodyKey: requiresQrBeforeStart
      ? "workdayPrivacyBodyQr"
      : runsContinuousTracking
        ? "workdayPrivacyBodyContinuousGps"
        : capturesEventGps
          ? "workdayPrivacyBodyEventGps"
          : "workdayPrivacyBodyNoLocation",
  }
}
