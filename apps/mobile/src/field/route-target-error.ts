import { AuthLostError, HttpError, MobileOperationError, UpgradeRequiredError } from "../sync/ports-error"
import type { MessageKey } from "../i18n"

export type RouteTargetLoadFailure = {
  kind: "session" | "upgrade" | "assignment" | "service" | "network" | "unknown"
  messageKey: MessageKey
  retryable: boolean
  correlationId: string | null
}

function detailCode(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null
  const code = (detail as Record<string, unknown>).code
  return typeof code === "string" ? code : null
}

function correlationId(error: HttpError | MobileOperationError): string | null {
  return error.diagnostic?.correlationId ?? null
}

/**
 * Routes must never turn every failure into "check the internet". This maps
 * only stable transport facts and allow-listed API codes to user actions; it
 * deliberately never exposes a backend message, endpoint or response body.
 */
export function routeTargetLoadFailure(error: unknown): RouteTargetLoadFailure {
  if (error instanceof AuthLostError) {
    return { kind: "session", messageKey: "fieldSessionExpired", retryable: false, correlationId: null }
  }
  if (error instanceof UpgradeRequiredError) {
    return { kind: "upgrade", messageKey: "upgradeBody", retryable: false, correlationId: null }
  }
  if (error instanceof HttpError) {
    const code = detailCode(error.detail)
    if (error.status === 403) {
      return {
        kind: "assignment",
        messageKey: code === "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED"
          ? "routeTargetScopeDenied"
          : "routeTargetAssignmentDenied",
        retryable: false,
        correlationId: correlationId(error),
      }
    }
    if (error.status === 404 && code === "MTM_MOBILE_ROUTE_TARGET_AGENT_NOT_FOUND") {
      return { kind: "assignment", messageKey: "routeTargetAgentUnavailable", retryable: false, correlationId: correlationId(error) }
    }
    if (error.status === 404 || error.status >= 500) {
      return { kind: "service", messageKey: "routeTargetServiceUnavailable", retryable: true, correlationId: correlationId(error) }
    }
    return { kind: "unknown", messageKey: "routeTargetLoadError", retryable: true, correlationId: correlationId(error) }
  }
  if (error instanceof MobileOperationError) {
    return {
      kind: error.diagnostic.stage === "network" ? "network" : "service",
      messageKey: error.diagnostic.stage === "network" ? "routeTargetNetworkError" : "routeTargetServiceUnavailable",
      retryable: true,
      correlationId: correlationId(error),
    }
  }
  return { kind: "unknown", messageKey: "routeTargetLoadError", retryable: true, correlationId: null }
}
