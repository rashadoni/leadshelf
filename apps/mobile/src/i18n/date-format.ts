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
