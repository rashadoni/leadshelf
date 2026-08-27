import {
  fieldNotificationTargetKinds,
  type FieldNotification,
  type FieldNotificationTarget,
  type FieldNotificationTargetKind,
} from "./contracts"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function dateKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function routeDateHint(metadata: unknown): string | null {
  return dateKey(record(metadata)?.routeDate)
}

function target(kind: string | null, id: string | null): FieldNotificationTarget | null {
  return kind && id && fieldNotificationTargetKinds.has(kind as FieldNotificationTargetKind)
    ? { kind: kind as FieldNotificationTargetKind, id }
    : null
}

/**
 * Reads the additive semantic target when present and understands the current
 * metadata producer keys during the server rollout. The app never needs to
 * infer a target from notification copy.
 */
export function notificationTarget(notification: FieldNotification): FieldNotificationTarget | null {
  const responseTarget = notification.target
    ? target(notification.target.kind, notification.target.id)
    : null
  if (responseTarget) return responseTarget
  const metadata = record(notification.metadata)
  if (!metadata) return null
  const nested = record(metadata.target)
  const semantic = target(string(nested?.kind), string(nested?.id))
  if (semantic) return semantic
  return (
    target("ROUTE", string(metadata.routeId))
    ?? target("VISIT", string(metadata.visitId))
    ?? target("TASK", string(metadata.taskId))
    ?? target("MESSAGE_THREAD", string(metadata.threadId))
    ?? target("CUSTOMER", string(metadata.customerId))
    ?? target("CONTACT", string(metadata.contactId))
    ?? target("CUSTOMER_REQUEST", string(metadata.requestId))
    ?? target("HRM_REQUEST", string(metadata.hrmRequestId))
    ?? target("ROUTE", Array.isArray(metadata.routeIds) ? string(metadata.routeIds[0]) : null)
  )
}

export function notificationDestination(notification: FieldNotification): string | null {
  const item = notificationTarget(notification)
  if (!item) return null
  switch (item.kind) {
    case "ROUTE": {
      const date = routeDateHint(notification.metadata)
      return "/(app)/routes/" + item.id + (date ? "?date=" + encodeURIComponent(date) : "")
    }
    case "VISIT":
      return "/(app)/field-visits/" + item.id
    case "TASK":
      return "/(app)/field-tasks/" + item.id
    case "MESSAGE_THREAD":
      return "/(app)/messages/" + item.id
    case "CUSTOMER":
      return "/(app)/organizations/" + item.id
    case "CONTACT":
      return "/(app)/contacts/" + item.id
    case "CUSTOMER_REQUEST":
      return "/(app)/customer-requests?requestId=" + encodeURIComponent(item.id)
    case "HRM_REQUEST":
      return "/(app)/hrm?requestId=" + encodeURIComponent(item.id)
  }
  return null
}

/**
 * A notification is always worth opening. Known semantic targets keep their
 * direct workspace navigation; notifications without a verified target open
 * a read-only detail instead of silently doing nothing after being marked read.
 */
export function notificationOpenDestination(notification: FieldNotification): string {
  return notificationDestination(notification)
    ?? "/(app)/notifications/" + encodeURIComponent(notification.id)
}
