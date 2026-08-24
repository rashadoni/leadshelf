import { t, type MessageKey } from "../i18n"
import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"

export type FieldErrorCodeOverrides = Readonly<Record<string, MessageKey>>

export const FIELD_TASK_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  MTM_TASK_VERSION_CONFLICT: "agentTaskConflictHint",
  MTM_TASK_STATUS_CONFLICT: "agentTaskConflictHint",
}

export const FIELD_ROUTE_ERROR_OVERRIDES: FieldErrorCodeOverrides = {
  ROUTE_VERSION_CONFLICT: "routeRefreshRequired",
  ROUTE_VERSION_REQUIRED: "routeRefreshRequired",
}

function errorCode(error: HttpError): string | null {
  const detail = error.detail
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
    return fieldErrorMessageForCode(errorCode(error), fallback, overrides)
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
