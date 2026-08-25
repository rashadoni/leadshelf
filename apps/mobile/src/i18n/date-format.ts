// Локализованная длинная дата для приветствия («понедельник, 15 июня»).
// Свои словари вместо Intl: Hermes/ICU на части Android-сборок не содержит
// az-локали, а дата должна работать полностью офлайн.
import type { Locale } from "./index"
import { tenantDateTimeParts } from "../field/tenant-time"

const WEEKDAYS: Record<Locale, string[]> = {
  az: ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"],
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
}

const MONTHS_GENITIVE: Record<Locale, string[]> = {
  az: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
}

const WEEKDAYS_SHORT: Record<Locale, string[]> = {
  az: ["B", "BE", "ÇA", "Ç", "CA", "C", "Ş"],
  ru: ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"],
}

const MONTHS_SHORT: Record<Locale, string[]> = {
  az: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"],
  ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
}

type CalendarDate = {
  year: number
  monthIndex: number
  day: number
  weekdayIndex: number
}

function calendarDateFromKey(dateKey: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, monthIndex, day, 12)
  if (
    !Number.isFinite(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
  ) {
    return null
  }
  return { year, monthIndex, day, weekdayIndex: date.getDay() }
}

function localizedCalendarDateText(date: CalendarDate, locale: Locale): string {
  return String(date.day) + " " + MONTHS_GENITIVE[locale][date.monthIndex]
}

/**
 * Deterministic labels for a calendar day.
 *
 * Android Hermes builds may not include Azerbaijani ICU data. Calendar labels
 * use the offline Field dictionary instead of falling back to the phone locale.
 */
export function formatCalendarDay(dateKey: string, locale: Locale): {
  day: string
  weekday: string
  date: string
} {
  const date = calendarDateFromKey(dateKey)
  if (!date) return { day: "", weekday: "", date: "" }
  return {
    day: String(date.day),
    weekday: WEEKDAYS[locale][date.weekdayIndex],
    date: localizedCalendarDateText(date, locale),
  }
}

/** A compact, locale-safe calendar date with year for cards and histories. */
export function formatCalendarDate(dateKey: string, locale: Locale): string {
  const date = calendarDateFromKey(dateKey)
  return date ? localizedCalendarDateText(date, locale) + " " + String(date.year) : ""
}

/** Compact deterministic labels for narrow date chips and route/HRM strips. */
export function formatCalendarWeekdayShort(dateKey: string, locale: Locale): string {
  const date = calendarDateFromKey(dateKey)
  return date ? WEEKDAYS_SHORT[locale][date.weekdayIndex] : ""
}

export function formatCalendarMonthShort(dateKey: string, locale: Locale): string {
  const date = calendarDateFromKey(dateKey)
  return date ? MONTHS_SHORT[locale][date.monthIndex] : ""
}

/** A locale-safe calendar range for Week, without Android Intl/ICU fallback. */
export function formatCalendarRange(startKey: string, endExclusiveKey: string, locale: Locale): string {
  const start = calendarDateFromKey(startKey)
  const endExclusive = calendarDateFromKey(endExclusiveKey)
  if (!start || !endExclusive) return ""
  const lastDay = new Date(endExclusive.year, endExclusive.monthIndex, endExclusive.day - 1, 12)
  const end: CalendarDate = {
    year: lastDay.getFullYear(),
    monthIndex: lastDay.getMonth(),
    day: lastDay.getDate(),
    weekdayIndex: lastDay.getDay(),
  }
  const startText = localizedCalendarDateText(start, locale)
  const endText = localizedCalendarDateText(end, locale)
  return start.year === end.year
    ? startText + " — " + endText + " " + String(end.year)
    : startText + " " + String(start.year) + " — " + endText + " " + String(end.year)
}

/** «понедельник, 15 июня» / «bazar ertəsi, 15 iyun» */
export function formatLongDate(date: Date, locale: Locale): string {
  const weekday = WEEKDAYS[locale][date.getDay()]
  const month = MONTHS_GENITIVE[locale][date.getMonth()]
  return `${weekday}, ${date.getDate()} ${month}`
}

/** A server-provided tenant calendar key is safer than the phone clock for Today. */
export function formatLongCalendarDate(dateKey: string, locale: Locale): string {
  const date = calendarDateFromKey(dateKey)
  return date ? `${WEEKDAYS[locale][date.weekdayIndex]}, ${localizedCalendarDateText(date, locale)}` : ""
}

/** Целые минуты между двумя моментами, не меньше нуля. */
export function minutesBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso).getTime()
  if (!Number.isFinite(from)) return 0
  return Math.max(0, Math.floor((to.getTime() - from) / 60000))
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/** Локальное время без зависимости от системной ICU-локали. */
export function formatTime(iso: string, timeZone?: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  if (timeZone) {
    const parts = tenantDateTimeParts(date, timeZone)
    return parts ? parts.time : iso.slice(11, 16)
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Короткая дата и время для истории операций. */
export function formatShortDateTime(iso: string, locale: Locale, timeZone?: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  if (timeZone) {
    const parts = tenantDateTimeParts(date, timeZone)
    if (parts) return `${parts.day} ${MONTHS_GENITIVE[locale][parts.month - 1]}, ${parts.time}`
    return `${iso.slice(8, 10)} ${MONTHS_GENITIVE[locale][Number(iso.slice(5, 7)) - 1] ?? ""}, ${iso.slice(11, 16)}`
  }
  return `${date.getDate()} ${MONTHS_GENITIVE[locale][date.getMonth()]}, ${formatTime(iso)}`
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}
