/**
 * Safe, mobile-facing view of route mutation conflicts.
 *
 * The API can include route, customer and employee identifiers in its 409
 * diagnostic payloads. Screens only need a stable reason and the local stop
 * positions to help a worker recover, so this parser intentionally drops all
 * of those identifiers.
 */
export type FieldRoutePointTimeConflict = {
  plannedTime: string
  pointIndexes: number[]
}

export type FieldRouteMutationConflict =
  | {
      kind: "duplicate"
      code: "ROUTE_DUPLICATE"
      duplicateRouteId: string | null
    }
  | {
      kind: "point_time"
      code: "ROUTE_POINT_TIME_CONFLICT"
      conflicts: FieldRoutePointTimeConflict[]
    }
  | {
      kind: "schedule"
      code: "ROUTE_CONFLICT"
    }
  | {
      kind: "version"
      code: "ROUTE_VERSION_CONFLICT" | "ROUTE_VERSION_REQUIRED"
    }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function pointTimeConflict(value: unknown): FieldRoutePointTimeConflict | null {
  const conflict = record(value)
  const plannedTime = string(conflict?.plannedTime)
  const rawIndexes = conflict?.pointIndexes
  if (!plannedTime || !Array.isArray(rawIndexes) || rawIndexes.length < 2) return null
  if (!rawIndexes.every((index) => typeof index === "number" && Number.isInteger(index) && index >= 0)) return null
  return { plannedTime, pointIndexes: rawIndexes }
}

/**
 * Parse only known, action-safe parts of a route conflict response. Unknown
 * or malformed details intentionally return null and fall back to generic
 * localised recovery copy instead of exposing backend text.
 */
export function parseFieldRouteMutationConflict(value: unknown): FieldRouteMutationConflict | null {
  const detail = record(value)
  const code = string(detail?.code)
  if (code === "ROUTE_DUPLICATE") {
    const duplicate = record(detail?.duplicate)
    return { kind: "duplicate", code, duplicateRouteId: string(duplicate?.id) }
  }
  if (code === "ROUTE_POINT_TIME_CONFLICT") {
    const rawConflicts = detail?.conflicts
    const conflicts = Array.isArray(rawConflicts)
      ? rawConflicts.map(pointTimeConflict).filter((conflict): conflict is FieldRoutePointTimeConflict => conflict !== null)
      : []
    if (conflicts.length === 0) return null
    return { kind: "point_time", code, conflicts }
  }
  if (code === "ROUTE_CONFLICT") {
    const conflicts = detail?.conflicts
    if (!Array.isArray(conflicts) || conflicts.length === 0) return null
    const knownScheduleConflict = conflicts.every((conflict) => {
      const item = record(conflict)
      return item?.code === "AGENT_SCHEDULE_CONFLICT" ||
        item?.code === "CUSTOMER_OVERLAP" ||
        item?.code === "CONTACT_OVERLAP"
    })
    return knownScheduleConflict ? { kind: "schedule", code } : null
  }
  if (code === "ROUTE_VERSION_CONFLICT" || code === "ROUTE_VERSION_REQUIRED") {
    return { kind: "version", code }
  }
  return null
}

export function routeConflictPointIndexes(conflict: FieldRouteMutationConflict | null): number[] {
  if (conflict?.kind !== "point_time") return []
  return [...new Set(conflict.conflicts.flatMap((item) => item.pointIndexes))].sort((left, right) => left - right)
}
