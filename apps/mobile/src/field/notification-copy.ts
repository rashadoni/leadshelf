import { getLocale, t } from "../i18n"
import { formatCalendarDay } from "../i18n/date-format"
import type { FieldNotification } from "./contracts"

export type FieldNotificationCopy = {
  title: string
  body: string | null
}

function eventName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const event = (metadata as Record<string, unknown>).event
  return typeof event === "string" ? event : null
}

function routeDate(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).routeDate
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function localizedRouteDate(metadata: unknown): string | null {
  const value = routeDate(metadata)
  return value ? formatCalendarDay(value, getLocale()).date || null : null
}

/**
 * Replaces only server notifications that have an explicit semantic event.
 * Arbitrary notification text remains intact: it can be a manager's message,
 * customer name, or another value that must not be guessed or translated.
 */
export function fieldNotificationCopy(notification: FieldNotification): FieldNotificationCopy {
  const date = localizedRouteDate(notification.metadata)
  switch (eventName(notification.metadata)) {
    case "route_published":
      return {
        title: t("notificationRoutePublishedTitle"),
        body: date
          ? t("notificationRoutePublishedBodyWithDate", { date })
          : t("notificationRoutePublishedBody"),
      }
    case "route_published_update":
      return {
        title: t("notificationRouteUpdatedTitle"),
        body: date
          ? t("notificationRouteUpdatedBodyWithDate", { date })
          : t("notificationRouteUpdatedBody"),
      }
    default:
      return { title: notification.title, body: notification.body }
  }
}
