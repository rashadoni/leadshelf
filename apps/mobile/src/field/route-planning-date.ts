import type { FieldWeekDay } from "./contracts"

type RoutePlanningDay = Pick<FieldWeekDay, "date" | "isToday" | "routePlanningAllowed">

function selectableDays(days: readonly RoutePlanningDay[], excludedDate: string | null): RoutePlanningDay[] {
  return days.filter((day) => day.routePlanningAllowed && day.date !== excludedDate)
}

/**
 * Keep an explicitly requested calendar date visible even when it is not
 * currently eligible. Replacing it with another date would make a Week link
 * appear to create a route for the wrong day.
 */
export function resolveRouteDraftDate(
  currentDate: string | null,
  requestedDate: string | null,
  days: readonly RoutePlanningDay[],
  excludedDate: string | null,
): string | null {
  const selectable = selectableDays(days, excludedDate)
  if (currentDate && selectable.some((day) => day.date === currentDate)) return currentDate
  if (currentDate && currentDate === requestedDate) return currentDate
  return selectable.find((day) => day.isToday)?.date ?? selectable[0]?.date ?? null
}

export function isRouteDraftDateAllowed(
  date: string | null,
  days: readonly RoutePlanningDay[],
  excludedDate: string | null,
): boolean {
  return Boolean(date && selectableDays(days, excludedDate).some((day) => day.date === date))
}
