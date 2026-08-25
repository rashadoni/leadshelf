import { t, type MessageKey } from "../i18n"
import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import { parseFieldRouteMutationConflict } from "./route-conflict"
import { formatRouteTime } from "./route-time"

export type FieldErrorCodeOverrides = Readonly<Record<string, MessageKey>>

export const FIELD_TASK_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  MTM_TASK_VERSION_CONFLICT: "agentTaskConflictHint",
  MTM_TASK_STATUS_CONFLICT: "agentTaskConflictHint",
}

export const FIELD_ROUTE_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  ROUTE_VERSION_CONFLICT: "routeRefreshRequired",
  ROUTE_VERSION_REQUIRED: "routeRefreshRequired",
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
  if (error instanceof UpgradeRequiredError) return t("upgradeBody")
  if (error instanceof AuthLostError) return t("fieldSessionExpired")
  if (error instanceof HttpError) {
    return fieldErrorMessageForCode(detailCode(error.detail), fallback, overrides)
  }
  return t(fallback)
}

/** Same safe mapping for an outbox result, where only a persisted API code remains. */
export function fieldErrorMessageForCode(
  code: unknown,
  fallback: MessageKey,
  overrides: FieldErrorCodeOverrides = {},
): string {
  if (typeof code === "string" && overrides[code]) return t(overrides[code])
  return t(fallback)
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
  const conflict = parseFieldRouteMutationConflict(detail)
  if (conflict?.kind === "duplicate") return t("routeConflictDuplicate")
  if (conflict?.kind === "schedule") return t("routeConflictSchedule")
  if (conflict?.kind === "version") return t("routeRefreshRequired")
  if (conflict?.kind === "point_time") {
    const first = conflict.conflicts[0]
    if (first) {
      const points = first.pointIndexes.map((index) => index + 1).join(", ")
      return t("routeConflictTime", {
        points,
        time: formatRouteTime(first.plannedTime, timeZone),
      })
    }
  }
  return fieldErrorMessageForCode(detailCode(detail), fallback, FIELD_ROUTE_ERROR_OVERRIDES)
}

/** Same route recovery copy for a direct API error, including auth/upgrade states. */
export function fieldRouteMutationErrorMessage(
  error: unknown,
  fallback: MessageKey,
  timeZone = "UTC",
): string {
  if (error instanceof UpgradeRequiredError || error instanceof AuthLostError) {
    return fieldErrorMessage(error, fallback, FIELD_ROUTE_ERROR_OVERRIDES)
  }
  if (error instanceof HttpError) return fieldRouteConflictMessage(error.detail, fallback, timeZone)
  return fieldErrorMessage(error, fallback, FIELD_ROUTE_ERROR_OVERRIDES)
}
