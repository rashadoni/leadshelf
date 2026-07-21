import { randomUUID } from "node:crypto"
import { captureToSentry } from "@leadshelf/core"

type OperationalLogLevel = "info" | "warn" | "error"

export type OperationalLogDetails = {
  correlationId?: string
  organizationId?: string
  deviceId?: string
  taskId?: string
  opId?: string
  jobId?: string
  batchId?: string
  photoSubmissionId?: string
  reviewId?: string
  status?: string
  provider?: string
  modelVersion?: string
  reasonCode?: string
  signal?: string
  draining?: boolean
  organizations?: number
  claimed?: number
  sent?: number
  retried?: number
  failed?: number
  retryAttempt?: number
  retryDelayMs?: number
}

const SAFE_DETAIL_KEYS = new Set<keyof OperationalLogDetails>([
  "correlationId", "organizationId", "deviceId", "taskId", "opId",
  "jobId", "batchId", "photoSubmissionId", "reviewId", "status",
  "provider", "modelVersion", "reasonCode", "signal", "draining",
  "organizations", "claimed", "sent", "retried", "failed",
  "retryAttempt", "retryDelayMs",
])

export function safeOperationalCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value)
    ? value
    : fallback
}

export function writeOperationalLog(
  level: OperationalLogLevel,
  component: string,
  event: string,
  details: OperationalLogDetails = {},
): void {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key, value]) =>
      SAFE_DETAIL_KEYS.has(key as keyof OperationalLogDetails) &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
    ),
  )
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    category: "operations",
    component,
    event,
    ...safeDetails,
  })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

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
