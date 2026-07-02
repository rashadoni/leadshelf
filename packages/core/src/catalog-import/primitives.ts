// Примитивы нормализации значений из 1С/Excel-выгрузок. Чистые функции.

/** Ячейка -> строка или null (пустые/пробельные -> null). */
export function cleanCell(value: string | undefined): string | null {
  if (value == null) return null
  const trimmed = value.replace(/[​-‍]/g, "").trim()
  return trimmed === "" ? null : trimmed
}

/**
 * Decimal из 1С: "12,50", "1 234,56", "1234.56" -> "1234.56" (строка!).
 * JS-число не используем — деньги теряют точность.
 */
export function parseDecimal(raw: string): string | null {
  let s = raw.replace(/[  ]/g, "") // тысячные пробелы (вкл. narrow nbsp)
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "") // 1.234,56
  s = s.replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return s
}

/** Целое (мм/граммы/штуки). */
export function parseInteger(raw: string): number | null {
  const s = raw.replace(/[  ]/g, "")
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/** Дата: "2026-07-02" | "02.07.2026" | "02/07/2026" -> "2026-07-02". */
export function parseDateOnly(raw: string): string | null {
  const s = raw.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else if ((match = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s))) {
    ;[d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else {
    return null
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null
  }
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`
}

export type BarcodeParse =
  | { ok: true; barcode: string }
  | { ok: false; reason: "excel_mangled" | "invalid" }

/**
 * Штрих-код: только цифры, ведущие нули значимы. Научная нотация
 * ("4,60483E+12") — Excel УЖЕ уничтожил точность, восстановить нельзя ->
 * ошибка с подсказкой перевыгрузить колонку текстом.
 */
export function parseBarcode(raw: string): BarcodeParse {
  const s = raw.trim()
  if (/e\+?\d+$/i.test(s)) return { ok: false, reason: "excel_mangled" }
  const digits = s.replace(/\s/g, "")
  if (!/^\d{4,14}$/.test(digits)) return { ok: false, reason: "invalid" }
  return { ok: true, barcode: digits }
}

const TRUE_VALUES = new Set(["1", "true", "да", "hə", "he", "aktiv", "активен", "yes", "x"])
const FALSE_VALUES = new Set(["0", "false", "нет", "yox", "неактивен", "qeyri-aktiv", "no"])

/** Булево из 1С/ручных файлов; null = не распознано. */
export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(s)) return true
  if (FALSE_VALUES.has(s)) return false
  return null
}

/** SKU: трим + схлопывание внутренних пробелов. Регистр сохраняем. */
export function normalizeSku(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

/** Имена брендов/поставщиков: трим + схлопывание пробелов (для natural key). */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}
