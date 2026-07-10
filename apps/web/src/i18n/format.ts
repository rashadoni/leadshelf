export function intlLocale(locale: string): string {
  return locale === "ru" ? "ru-RU" : "az-AZ"
}

export function formatLocaleDate(
  value: Date | string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" },
): string {
  if (!value) return "—"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  if (locale !== "ru" && options.dateStyle === "medium" && !options.timeStyle) {
    const months = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avq", "sen", "okt", "noy", "dek"]
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
  }
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date)
}

export function formatLocaleDateTime(
  value: Date | string | null | undefined,
  locale: string,
): string {
  return formatLocaleDate(value, locale, { dateStyle: "short", timeStyle: "short" })
}
