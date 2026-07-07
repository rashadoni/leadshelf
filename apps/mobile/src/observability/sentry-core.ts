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

function normalizeError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || "Error", value: error.message || String(error), stack: error.stack }
  }
  if (typeof error === "string") return { type: "Error", value: error }
  try {
    return { type: "Error", value: JSON.stringify(error) }
  } catch {
    return { type: "Error", value: String(error) }
  }
}

export function buildSentryEnvelope(dsnString: string, input: SentryEventInput): string {
  const nowMs = input.nowMs ?? Date.now()
  const normalized = normalizeError(input.error)
  const header = { event_id: input.eventId, sent_at: new Date(nowMs).toISOString(), dsn: dsnString }
  const event = {
    event_id: input.eventId,
    timestamp: nowMs / 1000,
    platform: "javascript",
    level: "error",
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.release ? { release: input.release } : {}),
    exception: { values: [{ type: normalized.type, value: normalized.value }] },
    ...(normalized.stack || input.context
      ? { extra: { ...(normalized.stack ? { stack: normalized.stack } : {}), ...(input.context ?? {}) } }
      : {}),
  }
  return [JSON.stringify(header), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") + "\n"
}

type MinimalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>

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
    await doFetch(sentryEnvelopeUrl(parsed), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: buildSentryEnvelope(options.dsn as string, {
        eventId: options.eventId,
        error: options.error,
        environment: options.environment,
        context: options.context,
      }),
    })
    return true
  } catch {
    return false
  }
}
