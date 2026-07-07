import { randomUUID } from "node:crypto"
import { captureToSentry } from "@leadshelf/core"

// Репортинг необработанных ошибок воркера в Sentry (docs/26 §10). Gated по
// SENTRY_DSN. Ставим process-обработчики один раз; сам репортинг не роняет
// процесс (captureToSentry глотает свои ошибки).
let installed = false

export function initErrorReporting(component: string): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn || installed) return
  installed = true
  const capture = (error: unknown) =>
    void captureToSentry({
      dsn,
      eventId: randomUUID().replace(/-/g, ""),
      error,
      platform: "node",
      environment: process.env.NODE_ENV,
      serverName: `leadshelf-worker-${component}`,
      context: { component },
    })
  process.on("uncaughtException", capture)
  process.on("unhandledRejection", capture)
}
