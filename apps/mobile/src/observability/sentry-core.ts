// RN-safe минимальный Sentry-репортёр (docs/26 §10). Отдельная копия от
// packages/core: тут парсим DSN регуляркой, а не `new URL` (в Hermes URL
// ненадёжен), и нет node/expo импортов — чистый модуль тестируется в CI.
// Осознанное ограничение: это не полный @sentry/react-native (нет нативных
// крашей/breadcrumbs), только JS-исключения. Зато работает и в Expo Go.

export interface ParsedSentryDsn {
  scheme: string
  host: string
  projectId: string
  publicKey: string
}

const DSN_RE = /^(https?):\/\/([^@]+)@([^/]+)\/(.+)$/

export function parseSentryDsn(dsn: string | undefined | null): ParsedSentryDsn | null {
  if (!dsn) return null
  const match = DSN_RE.exec(dsn.trim())
  if (!match) return null
  return { scheme: match[1]!, publicKey: match[2]!, host: match[3]!, projectId: match[4]! }
}

export function sentryEnvelopeUrl(dsn: ParsedSentryDsn): string {
  return `${dsn.scheme}://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`
}

export interface SentryEventInput {
  eventId: string
  error: unknown
  environment?: string | null
  release?: string | null
  context?: Record<string, unknown>
  nowMs?: number
}

const SAFE_METADATA = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/
const SAFE_CONTEXT_KEYS = new Set([
  "attempt", "component", "correlationId", "deviceId", "isFatal",
  "operation", "organizationId", "route", "runtime", "source",
  "statusCode", "taskId", "opId",
])

function safeMetadata(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && SAFE_METADATA.test(normalized) ? normalized : undefined
}

function normalizeErrorType(error: unknown): string {
  const candidate = error instanceof Error ? error.name : "Error"
  return SAFE_ERROR_TYPE.test(candidate) ? candidate : "Error"
}

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
  const header = { event_id: input.eventId, sent_at: new Date(nowMs).toISOString(), dsn: dsnString }
  const event = {
    event_id: input.eventId,
    timestamp: nowMs / 1000,
    platform: "javascript",
    level: "error",
    ...(environment ? { environment } : {}),
    ...(release ? { release } : {}),
    exception: { values: [{ type: errorType, value: `Unhandled ${errorType}` }] },
    extra: {
      telemetry_data_policy: "raw_error_redacted",
      has_stack: Boolean(input.error instanceof Error && input.error.stack),
      ...context,
    },
  }
  return [JSON.stringify(header), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") + "\n"
}

type MinimalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok?: boolean }>

export async function captureToSentry(options: {
  dsn: string | undefined | null
  eventId: string
  error: unknown
  environment?: string | null
  context?: Record<string, unknown>
  fetchImpl?: MinimalFetch
}): Promise<boolean> {
  const parsed = parseSentryDsn(options.dsn)
  if (!parsed) return false
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as MinimalFetch | undefined)
  if (!doFetch) return false
  try {
    const response = await doFetch(sentryEnvelopeUrl(parsed), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: buildSentryEnvelope(options.dsn as string, {
        eventId: options.eventId,
        error: options.error,
        environment: options.environment,
        context: options.context,
      }),
    })
    return response.ok !== false
  } catch {
    return false
  }
}
