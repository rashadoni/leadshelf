import { describe, expect, it } from "vitest"
import { notificationDestination, notificationOpenDestination, notificationTarget } from "./notification-target"
import type { FieldNotification } from "./contracts"

function notification(overrides: Partial<FieldNotification>): FieldNotification {
  return {
    id: "notification-1",
    title: "Title",
    body: null,
    type: "task",
    isRead: false,
    metadata: null,
    createdAt: "2026-08-24T12:00:00.000Z",
    ...overrides,
  }
}

describe("field notification navigation", () => {
  it("uses the additive semantic target when the API provides one", () => {
    const item = notification({ target: { kind: "ROUTE", id: "route-1" } })
    expect(notificationTarget(item)).toEqual({ kind: "ROUTE", id: "route-1" })
    expect(notificationDestination(item)).toBe("/(app)/routes/route-1")
    expect(notificationOpenDestination(item)).toBe("/(app)/routes/route-1")
  })

  it("keeps existing metadata producers navigable during the API rollout", () => {
    expect(notificationDestination(notification({ metadata: { taskId: "task-1" } }))).toBe("/(app)/field-tasks/task-1")
    expect(notificationDestination(notification({ metadata: { threadId: "thread-1" } }))).toBe("/(app)/messages/thread-1")
    expect(notificationDestination(notification({ metadata: { hrmRequestId: "request-1" } }))).toBe("/(app)/hrm")
    expect(notificationDestination(notification({ metadata: { routeIds: ["route-2"] } }))).toBe("/(app)/routes/route-2")
  })

  it("keeps every verified semantic target on its specific workspace", () => {
    expect(notificationOpenDestination(notification({ target: { kind: "ROUTE", id: "route-1" } }))).toBe("/(app)/routes/route-1")
    expect(notificationOpenDestination(notification({ target: { kind: "VISIT", id: "visit-1" } }))).toBe("/(app)/field-visits/visit-1")
    expect(notificationOpenDestination(notification({ target: { kind: "TASK", id: "task-1" } }))).toBe("/(app)/field-tasks/task-1")
    expect(notificationOpenDestination(notification({ target: { kind: "MESSAGE_THREAD", id: "thread-1" } }))).toBe("/(app)/messages/thread-1")
    expect(notificationOpenDestination(notification({ target: { kind: "CUSTOMER", id: "customer-1" } }))).toBe("/(app)/organizations/customer-1")
    expect(notificationOpenDestination(notification({ target: { kind: "CONTACT", id: "contact-1" } }))).toBe("/(app)/contacts/contact-1")
    expect(notificationOpenDestination(notification({ target: { kind: "CUSTOMER_REQUEST", id: "request-1" } }))).toBe("/(app)/customer-requests")
    expect(notificationOpenDestination(notification({ target: { kind: "HRM_REQUEST", id: "hrm-1" } }))).toBe("/(app)/hrm")
  })

  it("does not invent a target from notification text", () => {
    expect(notificationDestination(notification({ metadata: { title: "route-1" } }))).toBeNull()
  })

  it("opens read-only details when there is no verified semantic target", () => {
    const item = notification({ metadata: { title: "route-1" } })
    expect(notificationOpenDestination(item)).toBe("/(app)/notifications/notification-1")
  })
})
