import { describe, expect, it, vi } from "vitest"
import { buildSentryEnvelope, captureToSentry, parseSentryDsn, sentryEnvelopeUrl } from "./sentry-core"

const DSN = "https://abc123@o42.ingest.de.sentry.io/99"

describe("mobile sentry dsn (regex, RN-safe)", () => {
  it("parses a valid DSN without new URL", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      scheme: "https",
      host: "o42.ingest.de.sentry.io",
      projectId: "99",
      publicKey: "abc123",
    })
  })

  it("rejects broken DSNs", () => {
    expect(parseSentryDsn(null)).toBeNull()
    expect(parseSentryDsn("nope")).toBeNull()
    expect(parseSentryDsn("https://o42.ingest.sentry.io/99")).toBeNull()
  })

  it("builds the ingest URL", () => {
    expect(sentryEnvelopeUrl(parseSentryDsn(DSN)!)).toBe(
      "https://o42.ingest.de.sentry.io/api/99/envelope/?sentry_key=abc123&sentry_version=7",
    )
  })
})

describe("mobile sentry envelope + capture", () => {
  it("encodes a javascript exception event", () => {
    const env = buildSentryEnvelope(DSN, { eventId: "e1", error: new Error("boom"), nowMs: 1_700_000_000_000 })
    const [header, item, event] = env.trim().split("\n").map((l) => JSON.parse(l))
    expect(header.event_id).toBe("e1")
    expect(item).toEqual({ type: "event" })
    expect(event.platform).toBe("javascript")
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "Unhandled Error" })
    expect(event.extra).toMatchObject({ telemetry_data_policy: "raw_error_redacted", has_stack: true })
    expect(env).not.toContain("boom")
  })

  it("drops raw mobile errors, stacks, PII and non-allowlisted context", () => {
    const secret = "Bearer mobile.private.token"
    const error = new RangeError(`person@example.test pin=1234 ${secret}`)
    error.stack = `/data/user/0/private/session.ts ${secret}`
    const env = buildSentryEnvelope(DSN, {
      eventId: "e2",
      error,
      environment: "production secret=bad",
      context: {
        isFatal: true,
        component: "mobile-sync",
        email: "person@example.test",
        token: secret,
        route: "/sync?token=private",
      },
    })
    const event = JSON.parse(env.trim().split("\n")[2]!)
    expect(event.exception.values[0]).toEqual({ type: "RangeError", value: "Unhandled RangeError" })
    expect(event.extra).toMatchObject({ isFatal: true, component: "mobile-sync" })
    expect(event).not.toHaveProperty("environment")
    for (const forbidden of ["person@example.test", "1234", secret, "/data/user", "session.ts", "token="]) {
      expect(env).not.toContain(forbidden)
    }
  })

  it("keeps only the bounded fields from a handled sync diagnostic", () => {
    const secret = "Bearer private-token customer@example.test"
    const env = buildSentryEnvelope(DSN, {
      eventId: "e3",
      error: Object.assign(new Error(secret), { name: "MobileSyncFailure" }),
      context: {
        operation: "shelf.sync.pull",
        stage: "http",
        errorClass: "HTTP",
        statusCode: 503,
        correlationId: "mobile-12345678",
        rawResponse: secret,
        token: secret,
      },
    })
    const event = JSON.parse(env.trim().split("\n")[2]!)

    expect(event.extra).toMatchObject({
      operation: "shelf.sync.pull",
      stage: "http",
      errorClass: "HTTP",
      statusCode: 503,
      correlationId: "mobile-12345678",
    })
    expect(env).not.toContain(secret)
    expect(event.extra).not.toHaveProperty("rawResponse")
    expect(event.extra).not.toHaveProperty("token")
  })

  it("no-ops without a DSN and posts when set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    expect(await captureToSentry({ dsn: "", eventId: "x", error: new Error("y"), fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()

    expect(await captureToSentry({ dsn: DSN, eventId: "x", error: new Error("y"), fetchImpl })).toBe(true)
    expect(fetchImpl.mock.calls[0]![0]).toContain("/api/99/envelope/")
  })

  it("returns false when the ingest endpoint rejects the envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    expect(await captureToSentry({ dsn: DSN, eventId: "x", error: new Error("y"), fetchImpl })).toBe(false)
  })
})
