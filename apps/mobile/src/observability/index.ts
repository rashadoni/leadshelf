import * as Crypto from "expo-crypto"
import { captureToSentry } from "./sentry-core"
import type { SyncFailureDiagnostic } from "../sync/ports"

// Хук глобального обработчика ошибок RN -> Sentry. Gated по
// EXPO_PUBLIC_SENTRY_DSN (Expo инлайнит EXPO_PUBLIC_* на сборке). Без DSN —
// no-op. Цепляемся к предыдущему обработчику, чтобы dev-redbox не пропал.

interface RnErrorUtils {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void
}

let installed = false

export function initErrorReporting(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn || installed) return
  const errorUtils = (globalThis as { ErrorUtils?: RnErrorUtils }).ErrorUtils
  if (!errorUtils?.setGlobalHandler) return
  installed = true
  const previous = errorUtils.getGlobalHandler?.()
  errorUtils.setGlobalHandler((error, isFatal) => {
    void captureToSentry({
      dsn,
      eventId: Crypto.randomUUID().replace(/-/g, ""),
      error,
      environment: __DEV__ ? "development" : "production",
      context: { isFatal: !!isFatal },
    })
    previous?.(error, isFatal)
  })
}

/**
 * Handled sync failures are not allowed to disappear behind the generic
 * offline warning. Send only the deliberately bounded diagnostic; the raw
 * HTTP body and exception text never leave the device through this path.
 */
export function reportHandledSyncFailure(failure: SyncFailureDiagnostic): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn) return
  const error = new Error("Handled mobile sync failure")
  error.name = "MobileSyncFailure"
  void captureToSentry({
    dsn,
    eventId: Crypto.randomUUID().replace(/-/g, ""),
    error,
    environment: __DEV__ ? "development" : "production",
    context: {
      operation: failure.operation,
      stage: failure.stage,
      errorClass: failure.errorClass,
      ...(failure.statusCode === null ? {} : { statusCode: failure.statusCode }),
      ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
    },
  })
}
