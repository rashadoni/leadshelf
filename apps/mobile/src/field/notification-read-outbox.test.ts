import { describe, expect, it, vi } from "vitest"
import { HttpError } from "../sync/ports-error"
import {
  parseFieldNotificationReadPayload,
  sendFieldNotificationReadOperation,
  type FieldNotificationReadPushOperation,
} from "./notification-read-outbox"

const operation: FieldNotificationReadPushOperation = {
  clientOpId: "field-notification-read-op-1",
  clientCreatedAt: "2026-08-24T12:00:00.000Z",
  kind: "field.notification.read",
  payload: { notificationId: "notification-1" },
}

describe("field notification-read outbox", () => {
  it("accepts only one non-empty notification id", () => {
    expect(parseFieldNotificationReadPayload({ notificationId: "notification-1" }))
      .toEqual({ notificationId: "notification-1" })
    expect(() => parseFieldNotificationReadPayload({ notificationId: "" })).toThrow()
    expect(() => parseFieldNotificationReadPayload({ notificationId: " notification-1" })).toThrow()
  })

  it("sends a scoped idempotent read operation", async () => {
    const markNotificationRead = vi.fn().mockResolvedValue(undefined)

    await expect(sendFieldNotificationReadOperation(operation, { markNotificationRead }))
      .resolves.toEqual({ clientOpId: operation.clientOpId, status: "applied" })

    expect(markNotificationRead).toHaveBeenCalledWith("notification-1")
    expect(markNotificationRead).toHaveBeenCalledTimes(1)
  })

  it("leaves transient failures for shared outbox retry", async () => {
    const retryable = new HttpError(503, "temporarily unavailable")

    await expect(sendFieldNotificationReadOperation(operation, {
      markNotificationRead: vi.fn().mockRejectedValue(retryable),
    })).rejects.toBe(retryable)
  })

  it("records a permanent missing item as a conflict", async () => {
    await expect(sendFieldNotificationReadOperation(operation, {
      markNotificationRead: vi.fn().mockRejectedValue(new HttpError(404, "missing")),
    })).resolves.toMatchObject({
      clientOpId: operation.clientOpId,
      status: "conflict",
    })
  })
})
