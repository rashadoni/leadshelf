const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export type TenantDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dateKey: string
  time: string
}

function zonedParts(instant: Date, timeZone: string): TenantDateTimeParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    const values = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    )
    const year = Number(values.year)
    const month = Number(values.month)
    const day = Number(values.day)
    const hour = Number(values.hour)
    const minute = Number(values.minute)
    const second = Number(values.second)
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null
    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
      dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    }
  } catch {
    return null
  }
}

function offsetAt(instant: Date, timeZone: string): number | null {
  const parts = zonedParts(instant, timeZone)
  if (!parts) return null
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime()
}

/** Returns a tenant-local calendar date/time without depending on the phone timezone. */
export function tenantDateTimeParts(value: Date | string, timeZone: string): TenantDateTimeParts | null {
  const instant = value instanceof Date ? value : new Date(value)
  return Number.isFinite(instant.getTime()) ? zonedParts(instant, timeZone) : null
}

export function tenantDateKey(value: Date | string, timeZone: string): string | null {
  return tenantDateTimeParts(value, timeZone)?.dateKey ?? null
}

/**
 * Converts a planned wall-clock time in the tenant timezone into an ISO
 * instant. A nonexistent DST wall time is rejected instead of silently moving
 * it to the device timezone or the next valid minute.
 */
export function tenantDateTimeToIso(dateKey: string, time: string, timeZone: string): string | null {
  const dateMatch = DATE_PATTERN.exec(dateKey)
  const timeMatch = TIME_PATTERN.exec(time)
  if (!dateMatch || !timeMatch) return null

  const [year, month, day] = dateMatch.slice(1).map(Number)
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null

  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const firstOffset = offsetAt(new Date(wallClockUtc), timeZone)
  if (firstOffset == null) return null
  let instant = new Date(wallClockUtc - firstOffset)
  const correctedOffset = offsetAt(instant, timeZone)
  if (correctedOffset != null && correctedOffset !== firstOffset) {
    instant = new Date(wallClockUtc - correctedOffset)
  }

  const confirmed = zonedParts(instant, timeZone)
  if (
    !confirmed ||
    confirmed.year !== year ||
    confirmed.month !== month ||
    confirmed.day !== day ||
    confirmed.hour !== hour ||
    confirmed.minute !== minute
  ) return null
  return instant.toISOString()
}
