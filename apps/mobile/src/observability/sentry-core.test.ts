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
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "boom" })
  })

  it("no-ops without a DSN and posts when set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    expect(await captureToSentry({ dsn: "", eventId: "x", error: new Error("y"), fetchImpl })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()

    expect(await captureToSentry({ dsn: DSN, eventId: "x", error: new Error("y"), fetchImpl })).toBe(true)
    expect(fetchImpl.mock.calls[0]![0]).toContain("/api/99/envelope/")
  })
})
