import { describe, expect, it, vi } from "vitest"
import { buildApiContextLog, writeApiContextLog } from "./api-context-log"

function request(path: string, correlationId = "corr_01:retry") {
  const url = new URL(path, "https://example.test")
  return {
    method: "POST",
    nextUrl: { pathname: url.pathname },
    headers: new Headers({
      authorization: "Bearer secret-token",
      "x-correlation-id": correlationId,
      "x-private": "do-not-log",
    }),
  }
}

const claims = {
  sub: "user_01",
  org: "org_01",
  role: "STORE_STAFF",
  sid: "session_01",
  did: "device_01",
}

describe("authenticated API context log", () => {
  it("keeps allowlisted context and excludes query, tokens and session IDs", () => {
    const event = buildApiContextLog(
      request("/api/v1/tasks/task_01/status?search=private@example.test"),
      claims,
      new Date("2026-07-18T22:00:00.000Z"),
    )
    expect(event).toEqual({
      timestamp: "2026-07-18T22:00:00.000Z",
      level: "info",
      event: "api_authenticated",
      method: "POST",
      pathname: "/api/v1/tasks/task_01/status",
      correlationId: "corr_01:retry",
      organizationId: "org_01",
      userId: "user_01",
      deviceId: "device_01",
      taskId: "task_01",
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("private@example.test")
    expect(serialized).not.toContain("session_01")
  })

  it("drops unsafe caller IDs and writes one JSON line", () => {
    const sink = vi.fn()
    writeApiContextLog(request("/api/v1/catalog/products", "secret value with spaces"), claims, sink)
    expect(sink).toHaveBeenCalledOnce()
    expect(JSON.parse(sink.mock.calls[0]![0])).toMatchObject({
      event: "api_authenticated",
      organizationId: "org_01",
    })
    expect(sink.mock.calls[0]![0]).not.toContain("secret value")
  })
})
