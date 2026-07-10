// Локализованная длинная дата для приветствия («понедельник, 15 июня»).
// Свои словари вместо Intl: Hermes/ICU на части Android-сборок не содержит
// az-локали, а дата должна работать полностью офлайн.
import type { Locale } from "./index"

const WEEKDAYS: Record<Locale, string[]> = {
  az: ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"],
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
}

const MONTHS_GENITIVE: Record<Locale, string[]> = {
  az: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
}

/** «понедельник, 15 июня» / «bazar ertəsi, 15 iyun» */
export function formatLongDate(date: Date, locale: Locale): string {
  const weekday = WEEKDAYS[locale][date.getDay()]
  const month = MONTHS_GENITIVE[locale][date.getMonth()]
  return `${weekday}, ${date.getDate()} ${month}`
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
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Короткая дата и время для истории операций. */
export function formatShortDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  return `${date.getDate()} ${MONTHS_GENITIVE[locale][date.getMonth()]}, ${formatTime(iso)}`
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}
