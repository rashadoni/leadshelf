import type { RawCsvRow } from "./types"

// Заголовки CSV из 1С/Excel приходят на трех языках с произвольным
// регистром/пробелами/BOM. Нормализуем и сводим к canonical-полям контракта.

export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, "") // BOM
    .replace(/[​-‍ ]/g, "") // zero-width + nbsp
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
}

// canonical field -> нормализованные варианты заголовков (ru/az/en)
const HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku", "code", "артикул", "код", "kod", "artikul"],
  name: ["name", "наименование", "название", "ad", "adı", "adi"],
  barcode: ["barcode", "штрихкод", "barkod", "ean"],
  categoryPath: ["category", "categorypath", "категория", "kateqoriya"],
  categoryCode: ["categorycode", "кодкатегории", "kateqoriyakodu"],
  brandName: ["brand", "brandname", "бренд", "marka"],
  supplierName: ["supplier", "suppliername", "поставщик", "təchizatçı", "techizatci"],
  manufacturerName: [
    "manufacturer",
    "manufacturername",
    "производитель",
    "istehsalçı",
    "istehsalci",
  ],
  unit: ["unit", "единица", "едизм", "vahid", "ölçüvahidi", "olcuvahidi"],
  widthMm: ["width", "widthmm", "ширина", "en"],
  heightMm: ["height", "heightmm", "высота", "hündürlük", "hundurluk"],
  depthMm: ["depth", "depthmm", "глубина", "dərinlik", "derinlik"],
  weightG: ["weight", "weightg", "вес", "çəki", "ceki"],
  isSoftPack: ["issoftpack", "softpack", "soft", "мягкаяупаковка", "yumşaqpaket", "yumsaqpaket"],
  externalId: ["externalid", "id1c", "код1с", "guid"],
  isActive: ["isactive", "active", "активен", "aktiv", "status"],
  price: ["price", "цена", "qiymət", "qiymet"],
  costPrice: ["costprice", "себестоимость", "закупка", "mayadəyəri", "mayadeyeri"],
  currency: ["currency", "валюта", "valyuta"],
  date: ["date", "дата", "tarix"],
  storeCode: ["storecode", "store", "кодточки", "кодмагазина", "mağazakodu", "magazakodu"],
  warehouseCode: ["warehousecode", "warehouse", "склад", "anbar"],
  quantity: ["quantity", "qty", "количество", "miqdar"],
  revenue: ["revenue", "выручка", "оборот", "dövriyyə", "dovriyye"],
  profit: ["profit", "прибыль", "mənfəət", "menfeet"],
  scope: ["scope", "уровень", "səviyyə", "seviyye"],
  formatName: ["format", "formatname", "формат"],
  validFrom: ["validfrom", "датас", "başlanğıc", "baslangic"],
  validTo: ["validto", "датапо", "son"],
}

const LOOKUP: Map<string, string> = new Map()
for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
  LOOKUP.set(normalizeHeader(canonical), canonical)
  for (const a of aliases) LOOKUP.set(normalizeHeader(a), canonical)
}

/** Сырую строку CSV -> строка с canonical-ключами. Неизвестные колонки отбрасываются. */
export function canonicalizeRow(row: RawCsvRow): RawCsvRow {
  const out: RawCsvRow = {}
  for (const [key, value] of Object.entries(row)) {
    const canonical = LOOKUP.get(normalizeHeader(key))
    if (canonical && out[canonical] === undefined) out[canonical] = value
  }
  return out
}

/** Заголовки, которые не распознались (для warning в отчете качества). */
export function unknownHeaders(headers: string[]): string[] {
  return headers.filter((h) => !LOOKUP.has(normalizeHeader(h)))
}
