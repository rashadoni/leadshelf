import { describe, expect, it, vi } from "vitest"
import { buildMobileOperationLogs, writeMobileOperationLogs } from "./mobile-operation-log"

const operations = [{
  clientOpId: "op_01:retry",
  kind: "location.update",
  payload: { latitude: 40.4, longitude: 49.8, token: "must-not-log" },
}]
const results = [{
  clientOpId: "op_01:retry",
  status: "conflict",
  detail: { email: "private@example.test", reason: "must-not-log" },
}]

describe("mobile operation domain log", () => {
  it("logs only allowlisted body-derived operation context", () => {
    const events = buildMobileOperationLogs(
      operations as never,
      results as never,
      { organizationId: "org_01", deviceId: "device_01", correlationId: "corr_01" },
      new Date("2026-07-19T00:00:00.000Z"),
    )
    expect(events).toEqual([{
      timestamp: "2026-07-19T00:00:00.000Z",
      level: "info",
      event: "mobile_operation_processed",
      correlationId: "corr_01",
      organizationId: "org_01",
      deviceId: "device_01",
      opId: "op_01:retry",
      kind: "location.update",
      status: "conflict",
    }])
    expect(JSON.stringify(events)).not.toMatch(/latitude|longitude|token|email|reason|private/)
  })

  it("drops unsafe op/correlation IDs and never serializes payload or result detail", () => {
    const sink = vi.fn()
    writeMobileOperationLogs(
      [{ ...operations[0], clientOpId: "unsafe id" }] as never,
      [{ ...results[0], clientOpId: "unsafe id" }] as never,
      { organizationId: "org_01", deviceId: "device_01", correlationId: "secret value" },
      sink,
    )
    expect(sink).not.toHaveBeenCalled()
  })
})
