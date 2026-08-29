/**
 * H5 attendance trust is deliberately a small, versioned mobile contract.
 * The server remains the source of authorization and verifies every proof;
 * this module only decides which safe local interaction is needed.
 */

export type FieldAttendanceAction = "START" | "PAUSE" | "RESUME" | "FINISH"

export type FieldWorkforceAttendanceStatus = "NOT_CONFIGURED" | "ACTIVE" | "INVALID"

export interface FieldWorkforceAttendanceManifest {
  qrEnabled: boolean
  deviceTrustEnabled: boolean
  status: FieldWorkforceAttendanceStatus
  enforcementVersion: 1 | null
  configVersion: string | null
  qrRequiredActions: FieldAttendanceAction[]
  deviceTrustRequiredActions: FieldAttendanceAction[]
  biometricRequiredActions: FieldAttendanceAction[]
}

export interface FieldAttendanceRequirements {
  status: FieldWorkforceAttendanceStatus
  /** Invalid policy material stops the client before it can submit a false-safe action. */
  blocked: boolean
  qrRequired: boolean
  deviceTrustRequired: boolean
  biometricRequired: boolean
  /** QR tokens are short-lived and must be submitted immediately, never queued. */
  requiresEphemeralQrSubmission: boolean
}

export interface FieldDeviceAttendanceEvidence {
  enrollmentId: string
  signature: string
}

/** Evidence for an immediate workday push. QR is intentionally transient. */
export interface FieldWorkdayAttendanceEvidence {
  qrToken?: string
  device?: FieldDeviceAttendanceEvidence
}

/** Evidence safe to persist in the encrypted offline outbox. */
export interface FieldDurableWorkdayAttendanceEvidence {
  device: FieldDeviceAttendanceEvidence
}

export interface FieldDeviceAttendanceChallengeInput {
  organizationId: string
  agentId: string
  enrollmentId: string
  clientEventId: string
  action: FieldAttendanceAction
  workdayId: string
  occurredAt: string
}

export interface FieldDeviceEnrollmentChallengeInput {
  organizationId: string
  agentId: string
  enrollmentId: string
  challenge: string
}

export class FieldAttendanceContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FieldAttendanceContractError"
  }
}

const attendanceActions = new Set<FieldAttendanceAction>(["START", "PAUSE", "RESUME", "FINISH"])
const attendanceStatuses = new Set<FieldWorkforceAttendanceStatus>(["NOT_CONFIGURED", "ACTIVE", "INVALID"])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function validConfigVersion(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function validAction(value: unknown): value is FieldAttendanceAction {
  return typeof value === "string" && attendanceActions.has(value as FieldAttendanceAction)
}

function validActionList(value: unknown): value is FieldAttendanceAction[] {
  return Array.isArray(value) &&
    value.length <= attendanceActions.size &&
    value.every(validAction) &&
    new Set(value).size === value.length
}

function containsAll(values: FieldAttendanceAction[], expected: FieldAttendanceAction[]): boolean {
  const available = new Set(values)
  return expected.every((value) => available.has(value))
}

function sameActions(left: FieldAttendanceAction[], right: FieldAttendanceAction[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * A manifest is only actionable while it is an explicitly supported ACTIVE
 * version. Invalid/unknown material is rejected instead of silently becoming
 * an unprotected attendance action.
 */
export function isFieldWorkforceAttendanceManifest(value: unknown): value is FieldWorkforceAttendanceManifest {
  const manifest = record(value)
  if (
    !manifest ||
    !boolean(manifest.qrEnabled) ||
    !boolean(manifest.deviceTrustEnabled) ||
    typeof manifest.status !== "string" ||
    !attendanceStatuses.has(String(manifest.status) as FieldWorkforceAttendanceStatus) ||
    !validConfigVersion(manifest.configVersion) ||
    !(manifest.enforcementVersion === 1 || manifest.enforcementVersion === null) ||
    !validActionList(manifest.qrRequiredActions) ||
    !validActionList(manifest.deviceTrustRequiredActions) ||
    !validActionList(manifest.biometricRequiredActions)
  ) return false

  const status = manifest.status as FieldWorkforceAttendanceStatus
  const qrRequiredActions = manifest.qrRequiredActions as FieldAttendanceAction[]
  const deviceTrustRequiredActions = manifest.deviceTrustRequiredActions as FieldAttendanceAction[]
  const biometricRequiredActions = manifest.biometricRequiredActions as FieldAttendanceAction[]

  if (!containsAll(deviceTrustRequiredActions, biometricRequiredActions)) return false
  if (qrRequiredActions.length > 0 && !manifest.qrEnabled) return false
  if (deviceTrustRequiredActions.length > 0 && !manifest.deviceTrustEnabled) return false

  if (status === "ACTIVE") {
    return manifest.enforcementVersion === 1 && typeof manifest.configVersion === "string"
  }

  return manifest.enforcementVersion === null &&
    qrRequiredActions.length === 0 &&
    deviceTrustRequiredActions.length === 0 &&
    biometricRequiredActions.length === 0 &&
    (status === "INVALID" || manifest.configVersion == null)
}

export function parseFieldWorkforceAttendanceManifest(value: unknown): FieldWorkforceAttendanceManifest {
  if (!isFieldWorkforceAttendanceManifest(value)) {
    throw new FieldAttendanceContractError("Invalid workforce attendance manifest")
  }
  return value
}

export function equalFieldWorkforceAttendanceManifests(
  left: FieldWorkforceAttendanceManifest,
  right: FieldWorkforceAttendanceManifest,
): boolean {
  return left.qrEnabled === right.qrEnabled &&
    left.deviceTrustEnabled === right.deviceTrustEnabled &&
    left.status === right.status &&
    left.enforcementVersion === right.enforcementVersion &&
    left.configVersion === right.configVersion &&
    sameActions(left.qrRequiredActions, right.qrRequiredActions) &&
    sameActions(left.deviceTrustRequiredActions, right.deviceTrustRequiredActions) &&
    sameActions(left.biometricRequiredActions, right.biometricRequiredActions)
}

export function fieldAttendanceRequirementsForAction(
  attendance: FieldWorkforceAttendanceManifest | null | undefined,
  action: FieldAttendanceAction,
): FieldAttendanceRequirements {
  if (!attendance) {
    return {
      status: "NOT_CONFIGURED",
      blocked: false,
      qrRequired: false,
      deviceTrustRequired: false,
      biometricRequired: false,
      requiresEphemeralQrSubmission: false,
    }
  }
  if (!isFieldWorkforceAttendanceManifest(attendance)) {
    throw new FieldAttendanceContractError("Invalid workforce attendance manifest")
  }
  if (attendance.status !== "ACTIVE" || attendance.enforcementVersion !== 1) {
    return {
      status: attendance.status,
      blocked: attendance.status === "INVALID",
      qrRequired: false,
      deviceTrustRequired: false,
      biometricRequired: false,
      requiresEphemeralQrSubmission: false,
    }
  }

  const qrRequired = attendance.qrRequiredActions.includes(action)
  const deviceTrustRequired = attendance.deviceTrustRequiredActions.includes(action)
  return {
    status: attendance.status,
    blocked: false,
    qrRequired,
    deviceTrustRequired,
    biometricRequired: attendance.biometricRequiredActions.includes(action),
    requiresEphemeralQrSubmission: qrRequired,
  }
}

function validChallengeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)
}

function canonicalOccurredAt(value: unknown): string | null {
  if (typeof value !== "string") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Matches the LeadDrive server's exact P-256 signature preimage. */
export function workforceDeviceAttendanceChallenge(input: FieldDeviceAttendanceChallengeInput): string {
  const occurredAt = canonicalOccurredAt(input.occurredAt)
  if (
    !validChallengeIdentifier(input.organizationId) ||
    !validChallengeIdentifier(input.agentId) ||
    !validChallengeIdentifier(input.enrollmentId) ||
    !validChallengeIdentifier(input.clientEventId) ||
    !validAction(input.action) ||
    !validChallengeIdentifier(input.workdayId) ||
    !occurredAt
  ) {
    throw new FieldAttendanceContractError("Invalid workforce device attendance challenge")
  }

  return [
    "workforce-device-attendance:v1",
    `organizationId=${input.organizationId}`,
    `agentId=${input.agentId}`,
    `enrollmentId=${input.enrollmentId}`,
    `clientEventId=${input.clientEventId}`,
    `action=${input.action}`,
    `workdayId=${input.workdayId}`,
    `occurredAt=${occurredAt}`,
  ].join("\n")
}

/** Matches the one-time LeadDrive enrollment proof preimage. */
export function workforceDeviceEnrollmentChallenge(input: FieldDeviceEnrollmentChallengeInput): string {
  if (
    !validChallengeIdentifier(input.organizationId) ||
    !validChallengeIdentifier(input.agentId) ||
    !validChallengeIdentifier(input.enrollmentId) ||
    typeof input.challenge !== "string" ||
    !/^[A-Za-z0-9_-]{24,256}$/.test(input.challenge)
  ) {
    throw new FieldAttendanceContractError("Invalid workforce device enrollment challenge")
  }
  return [
    "workforce-device-enrollment:v1",
    `organizationId=${input.organizationId}`,
    `agentId=${input.agentId}`,
    `enrollmentId=${input.enrollmentId}`,
    `challenge=${input.challenge}`,
  ].join("\n")
}

function validEnrollmentId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value)
}

function validSignature(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8_192 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

/**
 * QR token material is explicitly excluded: it is short-lived and must never
 * enter SQLite/outbox persistence, even when that store is encrypted.
 */
export function parseFieldDurableWorkdayAttendanceEvidence(value: unknown): FieldDurableWorkdayAttendanceEvidence {
  const evidence = record(value)
  const device = record(evidence?.device)
  if (
    !evidence ||
    Object.keys(evidence).length !== 1 ||
    Object.keys(evidence)[0] !== "device" ||
    !device ||
    Object.keys(device).length !== 2 ||
    !validEnrollmentId(device.enrollmentId) ||
    !validSignature(device.signature)
  ) {
    throw new FieldAttendanceContractError("Invalid durable workforce attendance evidence")
  }

  return {
    device: {
      enrollmentId: device.enrollmentId,
      signature: device.signature,
    },
  }
}

/**
 * Parses evidence for an immediate network request only. Callers must never
 * pass this value to the SQLite/outbox layer: the QR may be short-lived and
 * remains in a component-local variable until the request completes.
 */
export function parseFieldTransientWorkdayAttendanceEvidence(value: unknown): FieldWorkdayAttendanceEvidence {
  const evidence = record(value)
  if (!evidence) {
    throw new FieldAttendanceContractError("Invalid transient workforce attendance evidence")
  }
  const keys = Object.keys(evidence)
  if (keys.length === 0 || keys.some((key) => key !== "qrToken" && key !== "device")) {
    throw new FieldAttendanceContractError("Invalid transient workforce attendance evidence")
  }
  const qrToken = evidence.qrToken
  if (
    qrToken != null &&
    (typeof qrToken !== "string" || !qrToken.trim() || qrToken.length > 4_096)
  ) {
    throw new FieldAttendanceContractError("Invalid transient workforce attendance evidence")
  }
  const device = evidence.device == null
    ? undefined
    : parseFieldDurableWorkdayAttendanceEvidence({ device: evidence.device }).device
  if (!qrToken && !device) {
    throw new FieldAttendanceContractError("Invalid transient workforce attendance evidence")
  }
  return {
    ...(typeof qrToken === "string" ? { qrToken: qrToken.trim() } : {}),
    ...(device ? { device } : {}),
  }
}
