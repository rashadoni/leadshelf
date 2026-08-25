import { tenantDateTimeParts, tenantDateTimeToIso } from "./tenant-time"

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export type RouteTimeConflict = {
  time: string
  indexes: number[]
}

export function isValidRouteTime(value: string): boolean {
  return value === "" || TIME_PATTERN.test(value)
}

/** Returns only valid, explicitly entered wall-clock collisions. */
export function findRouteTimeConflicts(times: readonly string[]): RouteTimeConflict[] {
  const indexesByTime = new Map<string, number[]>()
  times.forEach((rawTime, index) => {
    const time = rawTime.trim()
    if (!TIME_PATTERN.test(time)) return
    const indexes = indexesByTime.get(time) ?? []
    indexes.push(index)
    indexesByTime.set(time, indexes)
  })
  return [...indexesByTime.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([time, indexes]) => ({ time, indexes }))
}

export function formatRouteTime(iso: string | null, timeZone: string): string {
  if (!iso) return ""
  const instant = new Date(iso)
  if (!Number.isFinite(instant.getTime())) return ""
  const parts = tenantDateTimeParts(instant, timeZone)
  if (!parts) return iso.slice(11, 16)
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
}

export function routePlannedTime(dateKey: string, time: string, timeZone: string): string | null {
  return time ? tenantDateTimeToIso(dateKey, time, timeZone) : null
}

export function shiftDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

export function addMinutesToRouteTime(time: string, minutes: number): string {
  const match = TIME_PATTERN.exec(time)
  if (!match) return time
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutes + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}
