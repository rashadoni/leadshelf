import { afterEach, describe, expect, it } from "vitest"
import { getLocale, setLocale, t } from "../i18n"
import type { FieldNotification } from "./contracts"
import { fieldNotificationCopy } from "./notification-copy"

const initialLocale = getLocale()

function notification(overrides: Partial<FieldNotification> = {}): FieldNotification {
  return {
    id: "notification-1",
    title: "Route published",
    body: "Route for 2026-08-24 is ready.",
    type: "task",
    isRead: false,
    metadata: null,
    createdAt: "2026-08-24T12:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => setLocale(initialLocale))

describe("field notification copy", () => {
  it("localises the semantic route-published event instead of its English server template", () => {
    setLocale("az")
    expect(fieldNotificationCopy(notification({ metadata: { event: "route_published" } }))).toEqual({
      title: t("notificationRoutePublishedTitle"),
      body: t("notificationRoutePublishedBody"),
    })
  })

  it("uses an additive route date only when the server provides a valid semantic date", () => {
    setLocale("ru")
    expect(fieldNotificationCopy(notification({ metadata: { event: "route_published", routeDate: "2026-08-24" } }))).toEqual({
      title: t("notificationRoutePublishedTitle"),
      body: t("notificationRoutePublishedBodyWithDate", { date: "24 августа" }),
    })
  })

  it("does not rewrite an arbitrary notification body", () => {
    const item = notification({ title: "Manager note", body: "Please call the client." })
    expect(fieldNotificationCopy(item)).toEqual({ title: item.title, body: item.body })
  })
})
