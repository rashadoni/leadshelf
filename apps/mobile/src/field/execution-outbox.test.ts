import { describe, expect, it, vi } from "vitest"
import {
  parseFieldCommitmentCreatePayload,
  parseFieldCommitmentFulfillPayload,
  parseFieldDocumentStatePayload,
  parseFieldDocumentUploadPayload,
  parseFieldHrmRequestCancelPayload,
  parseFieldHrmRequestCreatePayload,
  parseFieldLocationPayload,
  parseFieldMessageCreatePayload,
  parseFieldMessageReceiptPayload,
  parseFieldTaskCreatePayload,
  parseFieldTaskEventPayload,
  parseFieldTaskUpdatePayload,
  parseFieldVisitActionPayload,
  parseFieldVisitCheckInPayload,
  parseFieldVisitPhotoPayload,
  parseFieldWorkdayEventPayload,
  sendFieldLocationOperation,
  sendFieldDocumentUploadOperation,
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

  it("preserves the LeadDrive workday recovery contract in the durable result", async () => {
    const operation: FieldExecutionPushOperation = {
      clientOpId: "field-workday-pause-conflict-1",
      clientCreatedAt: "2026-07-15T06:30:00.000Z",
      kind: "field.workday.event",
      payload: parseFieldWorkdayEventPayload({
        action: "PAUSE",
        workdayId: "mobile-workday-1",
        occurredAt: "2026-07-15T06:30:00.000Z",
        latitude: null,
        longitude: null,
        accuracy: null,
        note: null,
      }),
    }

    const [result] = await sendFieldExecutionOperations([operation], {
      push: vi.fn().mockResolvedValue({
        success: true,
        results: [{
          operationId: operation.clientOpId,
          status: "conflict",
          error: "Only a running workday can be paused",
          serverData: {
            code: "MTM_WORKDAY_NOT_RUNNING",
            workday: { id: "mobile-workday-1", status: "PAUSED" },
            allowedActions: ["RESUME", "FINISH"],
          },
        }],
      }),
    })

    expect(result).toEqual({
      clientOpId: operation.clientOpId,
      status: "conflict",
      detail: {
        code: "MTM_WORKDAY_NOT_RUNNING",
        workday: { id: "mobile-workday-1", status: "PAUSED" },
        allowedActions: ["RESUME", "FINISH"],
        error: "Only a running workday can be paused",
      },
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

  it("validates promise and fact quantities with at most two decimals", () => {
    const promise = parseFieldCommitmentCreatePayload({
      clientCommitmentId: "commitment-client-1",
      visitId: "field-visit-1",
      customerId: "clinic-1",
      customerName: "New Clinic",
      customerType: "CLINIC",
      contactId: "doctor-1",
      contactName: "Dr Aliyev",
      productExternalId: "sku-acc-200",
      productName: "ACC 200 mg",
      brandExternalId: "brand-acc",
      brandName: "ACC",
      promisedQuantity: 10.25,
      unit: "packs",
      dueAt: "2026-07-20T18:00:00.000Z",
      note: "Promise captured during the visit",
      evidenceClientPhotoId: "commitment-photo-1",
    })
    const fact = parseFieldCommitmentFulfillPayload({
      commitmentId: "commitment-server-1",
      clientFulfillmentId: "fulfillment-client-1",
      outcome: "PARTIAL",
      actualQuantity: 4.5,
      note: null,
      evidenceClientPhotoId: null,
    })

    expect(promise.promisedQuantity).toBe(10.25)
    expect(fact).toMatchObject({ outcome: "PARTIAL", actualQuantity: 4.5 })
    expect(() => parseFieldCommitmentCreatePayload({ ...promise, promisedQuantity: 10.125 })).toThrow()
    expect(() => parseFieldCommitmentFulfillPayload({ ...fact, actualQuantity: -1 })).toThrow()
  })

  it("maps immutable commitment promise and fact events without local display context", () => {
    const promise: FieldExecutionPushOperation = {
      clientOpId: "field-commitment-create-1",
      clientCreatedAt: "2026-07-16T08:00:00.000Z",
      kind: "field.commitment.create",
      payload: parseFieldCommitmentCreatePayload({
        clientCommitmentId: "commitment-client-1",
        visitId: "field-visit-1",
        customerId: "clinic-1",
        customerName: "New Clinic",
        customerType: "CLINIC",
        contactId: "doctor-1",
        contactName: "Dr Aliyev",
        productExternalId: "sku-acc-200",
        productName: "ACC 200 mg",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        promisedQuantity: 10,
        unit: "packs",
        dueAt: "2026-07-20T18:00:00.000Z",
        note: null,
        evidenceClientPhotoId: null,
      }),
    }
    const fact: FieldExecutionPushOperation = {
      clientOpId: "field-commitment-fulfill-1",
      clientCreatedAt: "2026-07-20T09:00:00.000Z",
      kind: "field.commitment.fulfill",
      payload: parseFieldCommitmentFulfillPayload({
        commitmentId: "commitment-server-1",
        clientFulfillmentId: "fulfillment-client-1",
        outcome: "FULFILLED",
        actualQuantity: 10,
        note: "Delivered",
        evidenceClientPhotoId: null,
      }),
    }

    expect(toFieldServerOperation(promise)).toEqual({
      operationId: "field-commitment-create-1",
      op: "create",
      entity: "commitments",
      clientTimestamp: new Date("2026-07-16T08:00:00.000Z").getTime(),
      data: {
        clientCommitmentId: "commitment-client-1",
        visitId: "field-visit-1",
        productExternalId: "sku-acc-200",
        productName: "ACC 200 mg",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        promisedQuantity: 10,
        unit: "packs",
        dueAt: "2026-07-20T18:00:00.000Z",
        note: null,
        evidenceClientPhotoId: null,
      },
    })
    expect(toFieldServerOperation(fact)).toMatchObject({
      op: "create",
      entity: "commitmentFulfillments",
      data: { commitmentId: "commitment-server-1", clientFulfillmentId: "fulfillment-client-1" },
    })
  })

  it("maps offline messages, receipts, document state and HRM requests", () => {
    const message: FieldExecutionPushOperation = {
      clientOpId: "field-message-op-0001",
      clientCreatedAt: "2026-07-16T08:00:00.000Z",
      kind: "field.message.send",
      payload: parseFieldMessageCreatePayload({
        threadId: "thread-1",
        recipientAgentId: null,
        clientMessageId: "message-client-0001",
        body: "Маршрут подтвержден",
        attachmentClientDocumentId: "document-client-0001",
        sentAt: "2026-07-16T08:00:00.000Z",
      }),
    }
    const receipt: FieldExecutionPushOperation = {
      clientOpId: "field-receipt-op-0001",
      kind: "field.message.receipt",
      payload: parseFieldMessageReceiptPayload({
        messageId: "message-1",
        type: "ACKNOWLEDGED",
        clientReceiptId: "receipt-client-0001",
        occurredAt: "2026-07-16T08:01:00.000Z",
      }),
    }
    const documentState: FieldExecutionPushOperation = {
      clientOpId: "field-document-state-0001",
      kind: "field.document.state",
      payload: parseFieldDocumentStatePayload({
        documentId: "document-1",
        state: "DOWNLOADED",
        occurredAt: "2026-07-16T08:02:00.000Z",
      }),
    }
    const hrm: FieldExecutionPushOperation = {
      clientOpId: "field-hrm-op-0001",
      kind: "field.hrm.create",
      payload: parseFieldHrmRequestCreatePayload({
        id: "hrm-mobile-1",
        clientRequestId: "hrm-client-0001",
        type: "LEAVE",
        startDate: "2026-07-20",
        endDate: "2026-07-22",
        correctionWorkdayId: null,
        requestedStartAt: null,
        requestedEndAt: null,
        reason: "Family leave",
        submittedAt: "2026-07-16T08:03:00.000Z",
      }),
    }
    const cancel: FieldExecutionPushOperation = {
      clientOpId: "field-hrm-cancel-0001",
      kind: "field.hrm.cancel",
      payload: parseFieldHrmRequestCancelPayload({
        id: "hrm-mobile-1",
        cancelledAt: "2026-07-16T08:04:00.000Z",
      }),
    }

    expect(toFieldServerOperation(message)).toMatchObject({ entity: "messages", op: "create" })
    expect(toFieldServerOperation(receipt)).toMatchObject({ entity: "messageReceipts", op: "create" })
    expect(toFieldServerOperation(documentState)).toMatchObject({ entity: "documentStates", op: "update" })
    expect(toFieldServerOperation(hrm)).toMatchObject({ entity: "hrmRequests", op: "create" })
    expect(toFieldServerOperation(cancel)).toMatchObject({ entity: "hrmRequests", op: "update" })
  })

  it("validates and classifies durable private document uploads", async () => {
    const payload = parseFieldDocumentUploadPayload({
      clientDocumentId: "document-client-0001",
      title: "Route evidence",
      fileName: "route.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      fileUri: "file:///documents/route.pdf",
      visitId: "visit-1",
      taskId: null,
      createdAt: "2026-07-16T08:00:00.000Z",
    })
    const operation = { clientOpId: "field-document-upload-1", kind: "field.document.upload" as const, payload }
    await expect(sendFieldDocumentUploadOperation(operation, {
      upload: vi.fn().mockResolvedValue({ id: "document-1", clientDocumentId: payload.clientDocumentId }),
    })).resolves.toMatchObject({ status: "applied", detail: { document: { id: "document-1" } } })
    await expect(sendFieldDocumentUploadOperation(operation, {
      upload: vi.fn().mockRejectedValue(new (await import("../sync/ports-error")).HttpError(409, "visit closed")),
    })).resolves.toMatchObject({ status: "conflict" })
    expect(() => parseFieldDocumentUploadPayload({ ...payload, mimeType: "application/x-executable" })).toThrow()
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
