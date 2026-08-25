import { shiftDateKey } from "./route-time"
import { tenantDateKey, tenantDateTimeParts, tenantDateTimeToIso } from "./tenant-time"

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export type FieldTaskDateOption = {
  key: string
  day: string
  month: string
}

/** Uses the tenant's calendar date rather than the device's local day. */
export function resolveFieldTaskToday(
  knownDate: string | null | undefined,
  timeZone: string,
  now = new Date(),
): string {
  if (knownDate && DATE_KEY.test(knownDate)) return knownDate
  return tenantDateKey(now, timeZone) ?? now.toISOString().slice(0, 10)
}

export function fieldTaskDateOptions(startDate: string, count = 8): FieldTaskDateOption[] {
  return Array.from({ length: count }, (_, index) => {
    const key = shiftDateKey(startDate, index)
    return { key, day: key.slice(8, 10), month: key.slice(5, 7) }
  })
}

export function isFieldTaskDueOnDate(
  dueDate: string | null,
  dateKey: string,
  timeZone: string,
): boolean {
  return Boolean(dueDate && tenantDateKey(dueDate, timeZone) === dateKey)
}

/** Turns the task's entered wall-clock due time into a tenant-safe ISO instant. */
export function fieldTaskDueDateTime(
  dateKey: string | null,
  time: string,
  timeZone: string,
): string | null {
  return dateKey ? tenantDateTimeToIso(dateKey, time, timeZone) : null
}

/** Keeps an existing due time on the tenant's calendar when rescheduling it. */
export function shiftFieldTaskDueDate(
  dueDate: string | null,
  days: number,
  fallbackDate: string,
  timeZone: string,
): string | null {
  const previous = dueDate ? tenantDateTimeParts(dueDate, timeZone) : null
  return tenantDateTimeToIso(
    shiftDateKey(previous?.dateKey ?? fallbackDate, days),
    previous?.time ?? "09:00",
    timeZone,
  )
}
