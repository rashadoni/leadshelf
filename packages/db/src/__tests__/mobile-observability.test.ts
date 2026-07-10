import { describe, expect, it } from "vitest"
import { buildMobileExecutionHealth } from "../repos/mobile-observability"

const now = new Date("2026-07-10T12:00:00.000Z")
const device = {
  id: "device-1",
  platform: "android",
  deviceName: "Pixel",
  lastSeenAt: new Date("2026-07-10T11:55:00.000Z"),
  user: { name: "Agent", employeeCode: "M-001" },
}

function operation(id: string, kind: string, status: "conflict" | "rejected" | "applied", hoursAgo: number) {
  const createdAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000 - 2_000)
  const processedAt = new Date(createdAt.getTime() + 2_000)
  return {
    deviceId: device.id,
    clientOpId: id,
    kind,
    status: status === "rejected" ? "FAILED" : "APPLIED",
    result: { status, detail: { code: `${status}_code`, secret: "must-not-leak" } },
    error: null,
    createdAt,
    processedAt,
  }
}

describe("mobile execution observability", () => {
  it("reports latency and payload-free actionable operations", () => {
    const health = buildMobileExecutionHealth({
      devices: [device],
      operations: [
        operation("operation-000001", "task.status", "conflict", 1),
        operation("operation-000002", "task.status", "conflict", 2),
        operation("operation-000003", "order.create", "rejected", 3),
        operation("operation-000004", "visit.checkin", "applied", 4),
      ],
      now,
    })
    expect(health).toMatchObject({ processedOps: 4, actionableOps: 3, conflicts: 2, rejectedOrders: 1, p95LatencyMs: 2_000 })
    expect(health.alerts).toEqual(["conflicts_growing", "order_failures_growing"])
    expect(JSON.stringify(health.operations)).not.toContain("must-not-leak")
    expect(health.operations[0]).toMatchObject({ clientTrace: "ION-000001", reason: "conflict_code" })
  })

  it("counts stale devices without raising a conflict or order alert", () => {
    const health = buildMobileExecutionHealth({
      devices: [{ ...device, lastSeenAt: new Date("2026-07-10T10:00:00.000Z") }],
      operations: [],
      now,
    })
    expect(health.staleDevices).toBe(1)
    expect(health.alerts).toEqual([])
  })
})
