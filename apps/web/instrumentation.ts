import { captureToSentry } from "@leadshelf/core"

// Захват серверных ошибок Next (route handlers, RSC) в Sentry. Gated по
// SENTRY_DSN — без него no-op (docs/26 §10). Никаких node-only импортов:
// хук исполняется и в node, и в edge рантайме.
function eventId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return raw.replace(/-/g, "")
}

export async function onRequestError(error: unknown): Promise<void> {
  await captureToSentry({
    dsn: process.env.SENTRY_DSN,
    eventId: eventId(),
    error,
    platform: "node",
    environment: process.env.NODE_ENV,
    serverName: "leadshelf-web",
    context: { source: "next.onRequestError" },
  })
}
