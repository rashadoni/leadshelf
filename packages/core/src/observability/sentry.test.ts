import { describe, expect, it, vi } from "vitest"
import { buildSentryEnvelope, captureToSentry, parseSentryDsn, sentryEnvelopeUrl } from "./sentry"

const DSN = "https://abc123@o42.ingest.de.sentry.io/99"

describe("sentry dsn parsing", () => {
  it("parses a valid DSN", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      scheme: "https",
      host: "o42.ingest.de.sentry.io",
      projectId: "99",
      publicKey: "abc123",
    })
  })

  it("rejects empty/broken DSNs", () => {
    expect(parseSentryDsn(undefined)).toBeNull()
    expect(parseSentryDsn("")).toBeNull()
    expect(parseSentryDsn("not-a-url")).toBeNull()
    expect(parseSentryDsn("https://o42.ingest.sentry.io/99")).toBeNull() // no public key
  })

  it("builds the envelope ingest URL with the key", () => {
    expect(sentryEnvelopeUrl(parseSentryDsn(DSN)!)).toBe(
      "https://o42.ingest.de.sentry.io/api/99/envelope/?sentry_key=abc123&sentry_version=7",
    )
  })
})

describe("sentry envelope", () => {
  it("encodes an exception event with a stable event id", () => {
    const envelope = buildSentryEnvelope(DSN, {
      eventId: "0123456789abcdef0123456789abcdef",
      error: new Error("boom"),
      platform: "node",
      environment: "test",
      nowMs: 1_700_000_000_000,
    })
    const lines = envelope.trim().split("\n")
    expect(lines).toHaveLength(3)
    const header = JSON.parse(lines[0]!)
    const item = JSON.parse(lines[1]!)
    const event = JSON.parse(lines[2]!)
    expect(header.event_id).toBe("0123456789abcdef0123456789abcdef")
    expect(header.dsn).toBe(DSN)
    expect(item).toEqual({ type: "event" })
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "Unhandled Error" })
    expect(event.extra).toMatchObject({ telemetry_data_policy: "raw_error_redacted", has_stack: true })
    expect(event.level).toBe("error")
    expect(event.environment).toBe("test")
    expect(event.timestamp).toBe(1_700_000_000)
  })

  it("never serializes raw error, stack, secret metadata or arbitrary context", () => {
    const secret = "Bearer eyJhbGciOiJIUzI1NiJ9.private.signature"
    const error = new TypeError(`failed for person@example.test password=hunter2 ${secret}`)
    error.stack = `/home/customer/private.ts:1 ${secret}`
    const env = buildSentryEnvelope(DSN, {
      eventId: "safe-event",
      error,
      environment: "production secret=bad",
      release: "release-42",
      serverName: "worker@example.test",
      context: {
        component: "proof-worker",
        isFatal: true,
        email: "person@example.test",
        token: secret,
        nested: { password: "hunter2" },
        route: "/api/v1/mobile/sync?token=private",
      },
    })
    const event = JSON.parse(env.trim().split("\n")[2]!)
    expect(event.exception.values[0]).toEqual({ type: "TypeError", value: "Unhandled TypeError" })
    expect(event.extra).toMatchObject({ component: "proof-worker", isFatal: true })
    expect(event).not.toHaveProperty("environment")
    expect(event.release).toBe("release-42")
    expect(event).not.toHaveProperty("server_name")
    for (const forbidden of ["person@example.test", "hunter2", secret, "/home/customer", "private.ts", "nested", "token="]) {
      expect(env).not.toContain(forbidden)
    }
  })
})

describe("captureToSentry", () => {
  it("no-ops without a DSN and never throws", async () => {
    const fetchImpl = vi.fn()
    expect(await captureToSentry({ dsn: undefined, eventId: "x", error: new Error("y"), fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts the envelope to the ingest URL when a DSN is set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const ok = await captureToSentry({ dsn: DSN, eventId: "abc", error: new Error("crash"), fetchImpl })
    expect(ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toContain("/api/99/envelope/?sentry_key=abc123")
    expect(init.method).toBe("POST")
    expect(init.body).not.toContain("crash")
  })

  it("reports an unsuccessful ingest response as failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    expect(await captureToSentry({ dsn: DSN, eventId: "abc", error: new Error("crash"), fetchImpl })).toBe(false)
  })

  it("swallows transport errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"))
    expect(await captureToSentry({ dsn: DSN, eventId: "abc", error: new Error("crash"), fetchImpl })).toBe(false)
  })
})
