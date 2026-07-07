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

function normalizeError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || "Error", value: error.message || String(error), stack: error.stack }
  }
  if (typeof error === "string") return { type: "Error", value: error }
  return { type: "Error", value: (() => {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  })() }
}

export function buildSentryEnvelope(dsnString: string, input: SentryEventInput): string {
  const nowMs = input.nowMs ?? Date.now()
  const normalized = normalizeError(input.error)
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
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.release ? { release: input.release } : {}),
    ...(input.serverName ? { server_name: input.serverName } : {}),
    exception: {
      values: [
        {
          type: normalized.type,
          value: normalized.value,
          ...(normalized.stack ? { stacktrace: { frames: [{ function: "<raw>", filename: "<raw>" }] } } : {}),
        },
      ],
    },
    ...(normalized.stack || input.context
      ? { extra: { ...(normalized.stack ? { stack: normalized.stack } : {}), ...(input.context ?? {}) } }
      : {}),
  }
  return [JSON.stringify(envelopeHeader), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") + "\n"
}

type MinimalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>

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
    await doFetch(sentryEnvelopeUrl(parsed), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    })
    return true
  } catch {
    return false
  }
}
