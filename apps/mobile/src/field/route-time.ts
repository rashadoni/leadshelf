const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(instant: Date, timeZone: string): ZonedParts | null {
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
    const parts = {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    }
    return Object.values(parts).every(Number.isFinite) ? parts : null
  } catch {
    return null
  }
}

function offsetAt(instant: Date, timeZone: string): number | null {
  const parts = zonedParts(instant, timeZone)
  if (!parts) return null
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime()
}

export function isValidRouteTime(value: string): boolean {
  return value === "" || TIME_PATTERN.test(value)
}

export function formatRouteTime(iso: string | null, timeZone: string): string {
  if (!iso) return ""
  const instant = new Date(iso)
  if (!Number.isFinite(instant.getTime())) return ""
  const parts = zonedParts(instant, timeZone)
  if (!parts) return iso.slice(11, 16)
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
}

export function routePlannedTime(dateKey: string, time: string, timeZone: string): string | null {
  if (!time) return null
  const match = TIME_PATTERN.exec(time)
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match || !dateMatch) return null

  const [year, month, day] = dateMatch.slice(1).map(Number)
  const hour = Number(match[1])
  const minute = Number(match[2])
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const firstOffset = offsetAt(new Date(wallClockUtc), timeZone)
  if (firstOffset == null) return new Date(wallClockUtc).toISOString()
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
