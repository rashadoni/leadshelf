import * as Crypto from "expo-crypto"
import { captureToSentry } from "./sentry-core"

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
