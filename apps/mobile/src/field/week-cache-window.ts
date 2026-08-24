import { shiftDateKey } from "./week-status"

/**
 * The Week tab may move one calendar week while the device is offline. Keep a
 * deliberately small window around the foreground week instead of prefetching
 * an unbounded calendar.
 */
export function adjacentWeekStarts(weekStart: string): [string, string] {
  return [shiftDateKey(weekStart, -7), shiftDateKey(weekStart, 7)]
}
