import type { MessageKey } from "../i18n"
import type { FieldRouteStatus } from "./contracts"

export type RouteStatusTone = "draft" | "planned" | "inProgress" | "completed" | "cancelled" | "missed"

const META: Record<FieldRouteStatus, { tone: RouteStatusTone; labelKey: MessageKey }> = {
  DRAFT: { tone: "draft", labelKey: "routeStatus_DRAFT" },
  PLANNED: { tone: "planned", labelKey: "routeStatus_PLANNED" },
  IN_PROGRESS: { tone: "inProgress", labelKey: "routeStatus_IN_PROGRESS" },
  COMPLETED: { tone: "completed", labelKey: "routeStatus_COMPLETED" },
  CANCELLED: { tone: "cancelled", labelKey: "routeStatus_CANCELLED" },
  MISSED: { tone: "missed", labelKey: "routeStatus_MISSED" },
}

export function routeStatusMeta(status: FieldRouteStatus) {
  return META[status]
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date key")
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function startOfIsoWeek(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date key")
  const weekday = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1))
  return date.toISOString().slice(0, 10)
}
