// Словарь единиц измерения: canonical-значения 1С/MTM (ru) + az/en варианты
// -> ProductUnit enum (docs/03 Phase 1, docs/12).

export type ProductUnit = "PCS" | "BOX" | "KG" | "L" | "PACK"

const UNIT_MAP: Record<string, ProductUnit> = {
  // PCS
  "шт": "PCS",
  "шт.": "PCS",
  "штука": "PCS",
  "əd": "PCS",
  "ed": "PCS",
  "ədəd": "PCS",
  "eded": "PCS",
  "pcs": "PCS",
  "pc": "PCS",
  // BOX
  "ящик": "BOX",
  "ящ": "BOX",
  "qutu": "BOX",
  "box": "BOX",
  "коробка": "BOX",
  // KG
  "кг": "KG",
  "кг.": "KG",
  "kq": "KG",
  "kg": "KG",
  // L
  "л": "L",
  "л.": "L",
  "litr": "L",
  "l": "L",
  // PACK
  "пачка": "PACK",
  "уп": "PACK",
  "упаковка": "PACK",
  "paçka": "PACK",
  "packa": "PACK",
  "pack": "PACK",
}

export const KNOWN_UNIT_INPUTS = Object.keys(UNIT_MAP)

export function parseUnit(raw: string | null): ProductUnit | null {
  if (raw == null) return "PCS" // default как в MTM ("шт")
  const unit = UNIT_MAP[raw.trim().toLowerCase()]
  return unit ?? null
}
