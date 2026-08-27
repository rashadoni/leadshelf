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
    expect(notificationOpenDestination(item)).toBe("/(app)/notifications/notification-1")
  })

  it("keeps existing metadata producers navigable during the API rollout", () => {
    expect(notificationDestination(notification({ metadata: { taskId: "task-1" } }))).toBe("/(app)/field-tasks/task-1")
    expect(notificationDestination(notification({ metadata: { threadId: "thread-1" } }))).toBe("/(app)/messages/thread-1")
    expect(notificationDestination(notification({ metadata: { hrmRequestId: "request-1" } }))).toBe("/(app)/hrm?requestId=request-1")
    expect(notificationDestination(notification({ metadata: { routeIds: ["route-2"] } }))).toBe("/(app)/routes/route-2")
  })

  it("falls back to a verified legacy target when an additive target is malformed", () => {
    const item = notification({
      target: { kind: "UNKNOWN" as never, id: "x" },
      metadata: { taskId: "task-1" },
    })
    expect(notificationDestination(item)).toBe("/(app)/field-tasks/task-1")
  })

  it("uses a valid route date only as a bounded route-context hint", () => {
    expect(notificationDestination(notification({ metadata: { routeId: "route-2", routeDate: "2026-08-24" } }))).toBe("/(app)/routes/route-2?date=2026-08-24")
    expect(notificationDestination(notification({ metadata: { routeId: "route-2", routeDate: "2026-02-30" } }))).toBe("/(app)/routes/route-2")
  })

  it("opens the notification detail before any linked workspace", () => {
    for (const target of [
      { kind: "ROUTE", id: "route-1" },
      { kind: "VISIT", id: "visit-1" },
      { kind: "TASK", id: "task-1" },
      { kind: "MESSAGE_THREAD", id: "thread-1" },
      { kind: "CUSTOMER", id: "customer-1" },
      { kind: "CONTACT", id: "contact-1" },
      { kind: "CUSTOMER_REQUEST", id: "request-1" },
      { kind: "HRM_REQUEST", id: "hrm-1" },
    ] as const) {
      expect(notificationOpenDestination(notification({ target }))).toBe("/(app)/notifications/notification-1")
    }
  })

  it("does not invent a target from notification text", () => {
    expect(notificationDestination(notification({ metadata: { title: "route-1" } }))).toBeNull()
  })

  it("opens read-only details when there is no verified semantic target", () => {
    const item = notification({ metadata: { title: "route-1" } })
    expect(notificationOpenDestination(item)).toBe("/(app)/notifications/notification-1")
  })
})
