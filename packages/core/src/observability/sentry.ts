// Минимальный зависимость-free репортёр ошибок в Sentry (envelope endpoint
// через fetch). Не полный SDK: без нативных крашей, breadcrumbs и tracing —
// только захват исключений. Выбран осознанно, чтобы работать и на сервере, и
// в Expo Go без нативной сборки и без риска для билда (docs/26 §10). Всё
// gated по DSN: без DSN — no-op.

export interface ParsedSentryDsn {
  scheme: string
  host: string
  projectId: string
  publicKey: string
}

export function parseSentryDsn(dsn: string | undefined | null): ParsedSentryDsn | null {
  if (!dsn || !dsn.trim()) return null
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\/+/, "")
    if (!url.username || !url.host || !projectId) return null
    return { scheme: url.protocol.replace(/:$/, ""), host: url.host, projectId, publicKey: url.username }
  } catch {
    return null
  }
}

export function sentryEnvelopeUrl(dsn: ParsedSentryDsn): string {
  return `${dsn.scheme}://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`
}

export interface SentryEventInput {
  eventId: string
  error: unknown
  level?: "fatal" | "error" | "warning" | "info"
  platform?: "node" | "javascript"
  environment?: string | null
  release?: string | null
  serverName?: string | null
  context?: Record<string, unknown>
  nowMs?: number
}

const SAFE_METADATA = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/
const SAFE_CONTEXT_KEYS = new Set([
  "attempt",
  "component",
  "correlationId",
  "deviceId",
  "isFatal",
  "operation",
  "organizationId",
  "route",
  "runtime",
  "source",
  "statusCode",
  "taskId",
  "opId",
])

function safeMetadata(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && SAFE_METADATA.test(normalized) ? normalized : undefined
}

function normalizeErrorType(error: unknown): string {
  const candidate = error instanceof Error ? error.name : "Error"
  return SAFE_ERROR_TYPE.test(candidate) ? candidate : "Error"
}

/** Crash payloads are an external data boundary. Raw messages, stacks and
 * arbitrary objects can contain credentials, PII, SQL values or media paths,
 * so only an allowlisted operational context is exported. */
function safeContext(context: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(context ?? {}).slice(0, 24)) {
    if (!SAFE_CONTEXT_KEYS.has(key)) continue
    if (typeof value === "boolean") result[key] = value
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value
    else if (typeof value === "string") {
      const normalized = safeMetadata(value)
      if (normalized) result[key] = normalized
    }
  }
  return result
}

export function buildSentryEnvelope(dsnString: string, input: SentryEventInput): string {
  const nowMs = input.nowMs ?? Date.now()
  const errorType = normalizeErrorType(input.error)
  const context = safeContext(input.context)
  const environment = safeMetadata(input.environment)
  const release = safeMetadata(input.release)
  const serverName = safeMetadata(input.serverName)
  const envelopeHeader = {
    event_id: input.eventId,
    sent_at: new Date(nowMs).toISOString(),
    dsn: dsnString,
  }
  const event = {
    event_id: input.eventId,
    timestamp: nowMs / 1000,
    platform: input.platform ?? "node",
    level: input.level ?? "error",
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    ...(serverName ? { server_name: serverName } : {}),
    exception: {
      values: [
        {
          type: errorType,
          value: `Unhandled ${errorType}`,
        },
      ],
    },
    extra: {
      telemetry_data_policy: "raw_error_redacted",
      has_stack: Boolean(input.error instanceof Error && input.error.stack),
      ...context,
    },
  }
  return [JSON.stringify(envelopeHeader), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") + "\n"
}

type MinimalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok?: boolean }>

export interface CaptureToSentryOptions extends SentryEventInput {
  dsn: string | undefined | null
  fetchImpl?: MinimalFetch
}

/** Отправляет исключение в Sentry. Возвращает false и ничего не делает, если
 *  DSN не задан или отправка упала — репортинг ошибок не должен ронять
 *  приложение. */
export async function captureToSentry(options: CaptureToSentryOptions): Promise<boolean> {
  const parsed = parseSentryDsn(options.dsn)
  if (!parsed) return false
  const body = buildSentryEnvelope(options.dsn as string, options)
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as MinimalFetch | undefined)
  if (!doFetch) return false
  try {
    const response = await doFetch(sentryEnvelopeUrl(parsed), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    })
    return response.ok !== false
  } catch {
    return false
  }
}
