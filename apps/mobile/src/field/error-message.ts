import { t, type MessageKey } from "../i18n"
import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import { parseFieldRouteMutationConflict } from "./route-conflict"
import { formatRouteTime } from "./route-time"

export type FieldErrorCodeOverrides = Readonly<Record<string, MessageKey>>
export type FieldMessage = {
  key: MessageKey
  values?: Record<string, string | number>
}

export const FIELD_TASK_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  MTM_TASK_VERSION_CONFLICT: "agentTaskConflictHint",
  MTM_TASK_STATUS_CONFLICT: "agentTaskConflictHint",
}

export const FIELD_ROUTE_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  ROUTE_VERSION_CONFLICT: "routeRefreshRequired",
  ROUTE_VERSION_REQUIRED: "routeRefreshRequired",
}

// Only map codes that are part of the existing mobile visit contract.  An
// unknown server code must retain the neutral, actionable fallback rather
// than exposing raw backend text or guessing at a GPS policy.
export const FIELD_VISIT_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  MTM_VISIT_OUT_OF_ZONE: "fieldVisitOutsideAllowedArea",
}

function detailCode(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const code = (detail as Record<string, unknown>).code
  return typeof code === "string" ? code : null
}

/**
 * Converts transport errors into stable, localised Field copy.
 *
 * Backend `error`, `message` and `details` are intentionally never exposed:
 * they can be English, technical, or reveal implementation details. A caller
 * supplies the copy that matches the current user action and can refine known
 * API codes without making HTTP status alone mean something it does not.
 */
export function fieldErrorMessage(
  error: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): string {
  return fieldMessageText(fieldErrorMessageData(error, fallback, overrides))
}

/** Renders a locale-independent Field message with the locale active now. */
export function fieldMessageText(message: FieldMessage): string {
  return t(message.key, message.values)
}

/**
 * Keeps error copy as a key until the screen renders it. This prevents a
 * language switch from leaving an old AZ/RU string in otherwise new UI.
 */
export function fieldErrorMessageData(
  error: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): FieldMessage {
  return { key: fieldErrorMessageKey(error, fallback, overrides) }
}

/**
 * Returns stable copy metadata rather than translated text. Screens that keep
 * an error in state can render this key with the current locale, so switching
 * AZ/RU never leaves an earlier language trapped in an otherwise new UI.
 */
export function fieldErrorMessageKey(
  error: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): MessageKey {
  if (error instanceof UpgradeRequiredError) return "upgradeBody"
  if (error instanceof AuthLostError) return "fieldSessionExpired"
  if (error instanceof HttpError) {
    return fieldErrorMessageKeyForCode(detailCode(error.detail), fallback, overrides)
  }
  return fallback
}

/** Same safe mapping for an outbox result, where only a persisted API code remains. */
export function fieldErrorMessageForCode(
  code: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): string {
  return t(fieldErrorMessageKeyForCode(code, fallback, overrides))
}

/** Same mapping as fieldErrorMessageForCode, kept as locale-independent data. */
export function fieldErrorMessageKeyForCode(
  code: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): MessageKey {
  if (typeof code === "string" && overrides[code]) return overrides[code]
  return fallback
}

/**
 * Converts a persisted or live route conflict into specific, localised
 * recovery guidance. The parser intentionally excludes backend text and IDs.
 */
export function fieldRouteConflictMessage(
  detail: unknown,
  fallback: MessageKey,
  timeZone = "UTC",
): string {
  return fieldMessageText(fieldRouteConflictMessageData(detail, fallback, timeZone))
}

/** Same route recovery guidance as locale-independent key and values. */
export function fieldRouteConflictMessageData(
  detail: unknown,
  fallback: MessageKey,
  timeZone = "UTC",
): FieldMessage {
  const conflict = parseFieldRouteMutationConflict(detail)
  if (conflict?.kind === "duplicate") return { key: "routeConflictDuplicate" }
  if (conflict?.kind === "schedule") return { key: "routeConflictSchedule" }
  if (conflict?.kind === "version") return { key: "routeRefreshRequired" }
  if (conflict?.kind === "point_time") {
    const first = conflict.conflicts[0]
    if (first) {
      const points = first.pointIndexes.map((index) => index + 1).join(", ")
      return { key: "routeConflictTime", values: { points, time: formatRouteTime(first.plannedTime, timeZone) } }
    }
  }
  return { key: fieldErrorMessageKeyForCode(detailCode(detail), fallback, FIELD_ROUTE_ERROR_OVERRIDES) }
}

/** Same route recovery copy for a direct API error, including auth/upgrade states. */
export function fieldRouteMutationErrorMessage(
  error: unknown,
  fallback: MessageKey,
  timeZone = "UTC",
): string {
  return fieldMessageText(fieldRouteMutationErrorMessageData(error, fallback, timeZone))
}

/** Same direct API error mapping as locale-independent key and values. */
export function fieldRouteMutationErrorMessageData(
  error: unknown,
  fallback: MessageKey,
  timeZone = "UTC",
): FieldMessage {
  if (error instanceof UpgradeRequiredError || error instanceof AuthLostError) {
    return fieldErrorMessageData(error, fallback, FIELD_ROUTE_ERROR_OVERRIDES)
  }
  if (error instanceof HttpError) return fieldRouteConflictMessageData(error.detail, fallback, timeZone)
  return fieldErrorMessageData(error, fallback, FIELD_ROUTE_ERROR_OVERRIDES)
}
