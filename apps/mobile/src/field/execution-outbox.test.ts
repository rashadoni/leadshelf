import { describe, expect, it, vi } from "vitest"
import {
  parseFieldVisitActionPayload,
  parseFieldVisitCheckInPayload,
  sendFieldExecutionOperations,
  toFieldServerOperation,
  type FieldExecutionPushOperation,
} from "./execution-outbox"

const checkIn: FieldExecutionPushOperation = {
  clientOpId: "field-op-checkin-0001",
  clientCreatedAt: "2026-07-15T08:00:00.000Z",
  kind: "field.visit.checkin",
  payload: {
    visitId: "field-visit-1",
    customerId: "clinic-1",
    contactId: "doctor-1",
    routeId: "route-1",
    routePointId: "point-1",
    checkInAt: "2026-07-15T08:00:00.000Z",
    checkInLat: 40.4,
    checkInLng: 49.8,
    accuracyM: 12,
  },
}

describe("field execution outbox", () => {
  it("validates a durable route-targeted check-in", () => {
    expect(parseFieldVisitCheckInPayload(checkIn.payload)).toMatchObject({
      visitId: "field-visit-1",
      contactId: "doctor-1",
      accuracyM: 12,
    })
    expect(() => parseFieldVisitCheckInPayload({ ...checkIn.payload, checkInLat: "40.4" })).toThrow()
  })

  it("maps local operations to the existing idempotent LeadDrive protocol", () => {
    expect(toFieldServerOperation(checkIn)).toEqual({
      operationId: "field-op-checkin-0001",
      op: "create",
      entity: "visits",
      clientTimestamp: new Date("2026-07-15T08:00:00.000Z").getTime(),
      data: expect.objectContaining({
        id: "field-visit-1",
        routePointId: "point-1",
        contactId: "doctor-1",
      }),
    })
  })

  it("keeps visit create, action and checkout in batch order", async () => {
    const action: FieldExecutionPushOperation = {
      clientOpId: "field-op-action-0001",
      kind: "field.visit.action",
      payload: {
        actionResultId: "field-action-1",
        visitId: "field-visit-1",
        actionKey: "VISIT_NOTE",
        status: "COMPLETED",
        evidence: { note: "Discussed launch" },
        completedAt: "2026-07-15T08:10:00.000Z",
      },
    }
    const checkout: FieldExecutionPushOperation = {
      clientOpId: "field-op-checkout-0001",
      kind: "field.visit.update",
      payload: {
        visitId: "field-visit-1",
        status: "CHECKED_OUT",
        checkOutAt: "2026-07-15T08:30:00.000Z",
        checkOutLat: 40.4,
        checkOutLng: 49.8,
        outcome: "SUCCESSFUL",
        potential: "HIGH",
      },
    }
    expect(parseFieldVisitActionPayload(action.payload).actionKey).toBe("VISIT_NOTE")
    const push = vi.fn().mockImplementation(async (operations) => ({
      success: true as const,
      results: operations.map((operation: { operationId: string }, index: number) => ({
        operationId: operation.operationId,
        status: "ok" as const,
        serverId: index === 0 ? "field-visit-1" : `server-${index}`,
      })),
    }))

    const results = await sendFieldExecutionOperations([checkIn, action, checkout], { push })
    expect(push.mock.calls[0]?.[0].map((operation: { entity: string }) => operation.entity)).toEqual([
      "visits",
      "visitActions",
      "visits",
    ])
    expect(results.map((result) => result.status)).toEqual(["applied", "applied", "applied"])
  })

  it("surfaces deterministic conflicts and retries transient server errors", async () => {
    await expect(sendFieldExecutionOperations([checkIn], {
      push: vi.fn().mockResolvedValue({
        success: true,
        results: [{
          operationId: checkIn.clientOpId,
          status: "conflict",
          error: "Agent is outside the customer geofence",
          serverData: { code: "MTM_VISIT_OUT_OF_ZONE" },
        }],
      }),
    })).resolves.toEqual([expect.objectContaining({
      status: "conflict",
      detail: expect.objectContaining({ code: "MTM_VISIT_OUT_OF_ZONE" }),
    })])

    await expect(sendFieldExecutionOperations([checkIn], {
      push: vi.fn().mockResolvedValue({
        success: true,
        results: [{ operationId: checkIn.clientOpId, status: "error", error: "Internal error, retry" }],
      }),
    })).rejects.toThrow("Internal error")
  })
})
