import { describe, expect, it, vi } from "vitest"
import {
  parseFieldLocationPayload,
  parseFieldTaskCreatePayload,
  parseFieldTaskEventPayload,
  parseFieldTaskUpdatePayload,
  parseFieldVisitActionPayload,
  parseFieldVisitCheckInPayload,
  parseFieldVisitPhotoPayload,
  parseFieldWorkdayEventPayload,
  sendFieldLocationOperation,
  sendFieldVisitPhotoOperation,
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

  it("preserves causal workday ids for start and subsequent transitions", () => {
    const start: FieldExecutionPushOperation = {
      clientOpId: "field-workday-start-1",
      clientCreatedAt: "2026-07-15T05:00:00.000Z",
      kind: "field.workday.event",
      payload: parseFieldWorkdayEventPayload({
        action: "START",
        workdayId: "mobile-workday-1",
        occurredAt: "2026-07-15T05:00:00.000Z",
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        note: null,
      }),
    }
    const pause: FieldExecutionPushOperation = {
      ...start,
      clientOpId: "field-workday-pause-1",
      kind: "field.workday.event",
      payload: { ...start.payload, action: "PAUSE", occurredAt: "2026-07-15T06:00:00.000Z" },
    }
    expect(toFieldServerOperation(start)).toMatchObject({
      operationId: "field-workday-start-1",
      op: "create",
      entity: "workdays",
      data: { id: "mobile-workday-1", action: "START", latitude: 0, longitude: 0, accuracy: 0 },
    })
    expect(toFieldServerOperation(pause)).toMatchObject({
      operationId: "field-workday-pause-1",
      entity: "workdays",
      data: { workdayId: "mobile-workday-1", action: "PAUSE" },
    })
  })

  it("maps task create, versioned update and comment to the LeadDrive sync protocol", () => {
    const create: FieldExecutionPushOperation = {
      clientOpId: "field-task-create-1",
      clientCreatedAt: "2026-07-15T08:00:00.000Z",
      kind: "field.task.create",
      payload: parseFieldTaskCreatePayload({
        taskId: "field-task-1",
        title: "Call clinic",
        priority: "HIGH",
        dueDate: "2026-07-16T09:00:00.000Z",
        recurrence: { rule: "WEEKLY", interval: 1, until: null },
      }),
    }
    const update: FieldExecutionPushOperation = {
      clientOpId: "field-task-update-1",
      kind: "field.task.update",
      payload: parseFieldTaskUpdatePayload({
        taskId: "field-task-1",
        expectedVersion: 1,
        status: "IN_PROGRESS",
      }),
    }
    const comment: FieldExecutionPushOperation = {
      clientOpId: "field-task-comment-1",
      kind: "field.task.event",
      payload: parseFieldTaskEventPayload({
        taskId: "field-task-1",
        type: "COMMENTED",
        occurredAt: "2026-07-15T08:05:00.000Z",
        comment: "Doctor asked to call later",
      }),
    }
    expect(toFieldServerOperation(create)).toMatchObject({ op: "create", entity: "tasks", data: { id: "field-task-1", title: "Call clinic" } })
    expect(toFieldServerOperation(update)).toMatchObject({ op: "update", entity: "tasks", data: { id: "field-task-1", expectedVersion: 1, status: "IN_PROGRESS" } })
    expect(toFieldServerOperation(comment)).toMatchObject({ op: "create", entity: "taskEvents", data: { taskId: "field-task-1", type: "COMMENTED" } })
  })

  it("validates replay-safe locations and classifies deterministic GPS conflicts", async () => {
    const payload = parseFieldLocationPayload({
      clientLocationId: "gps-1784091600000-0.000000-0.000000",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
      speed: 0,
      heading: 0,
      altitude: 0,
      battery: 0,
      recordedAt: "2026-07-15T05:00:00.000Z",
    })
    const operation = { clientOpId: "field-location-1", kind: "field.location" as const, payload }
    await expect(sendFieldLocationOperation(operation, {
      upload: vi.fn().mockResolvedValue({ id: "server-location-1", ...payload }),
    })).resolves.toMatchObject({ status: "applied", detail: { location: { id: "server-location-1" } } })
    await expect(sendFieldLocationOperation(operation, {
      upload: vi.fn().mockRejectedValue(new (await import("../sync/ports-error")).HttpError(409, "stale workday")),
    })).resolves.toMatchObject({ status: "conflict" })
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

  it("validates and uploads durable visit photos with conflict classification", async () => {
    const operation = {
      clientOpId: "field-photo-op-0001",
      kind: "field.visit.photo" as const,
      payload: parseFieldVisitPhotoPayload({
        clientPhotoId: "mobile-photo-0001",
        visitId: "field-visit-1",
        agentId: "agent-1",
        fileUri: "file:///photo.jpg",
        category: "visit",
        latitude: 40.4,
        longitude: 49.8,
        takenAt: "2026-07-15T08:15:00.000Z",
      }),
    }
    await expect(sendFieldVisitPhotoOperation(operation, {
      upload: vi.fn().mockResolvedValue({ id: "server-photo-1", url: "/photo.jpg" }),
    })).resolves.toMatchObject({
      status: "applied",
      detail: { photo: { id: "server-photo-1" } },
    })
    await expect(sendFieldVisitPhotoOperation(operation, {
      upload: vi.fn().mockRejectedValue(new (await import("../sync/ports-error")).HttpError(409, "visit closed")),
    })).resolves.toMatchObject({ status: "conflict" })
  })
})
