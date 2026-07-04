import {
  productImportRowV1,
  type ProductImportRowV1,
} from "@leadshelf/api-contracts/import/v1"
import { canonicalizeRow } from "./headers"
import {
  cleanCell,
  normalizeName,
  normalizeSku,
  parseBarcode,
  parseBool,
  parseInteger,
} from "./primitives"
import { parseUnit, KNOWN_UNIT_INPUTS } from "./units"
import { issue, type ParseResult, type RawCsvRow, type RowIssue } from "./types"

const DIMENSION_FIELDS = ["widthMm", "heightMm", "depthMm", "weightG"] as const

export function parseProductRow(
  raw: RawCsvRow,
  rowNumber: number,
): ParseResult<ProductImportRowV1> {
  const row = canonicalizeRow(raw)
  const errors: RowIssue[] = []
  const warnings: RowIssue[] = []
  const get = (k: string) => cleanCell(row[k])

  const skuRaw = get("sku")
  if (!skuRaw) errors.push(issue(rowNumber, "sku (артикул) обязателен", { field: "sku" }))
  const name = get("name")
  if (!name) errors.push(issue(rowNumber, "name (наименование) обязательно", { field: "name" }))

  // barcode: отсутствие — warning (data quality), мусор — error
  let barcode: string | null = null
  const barcodeRaw = get("barcode")
  if (barcodeRaw == null) {
    warnings.push(
      issue(rowNumber, "штрих-код отсутствует", { field: "barcode", severity: "warning" }),
    )
  } else {
    const parsed = parseBarcode(barcodeRaw)
    if (parsed.ok) {
      barcode = parsed.barcode
    } else if (parsed.reason === "excel_mangled") {
      errors.push(
        issue(rowNumber, `штрих-код испорчен Excel (${barcodeRaw})`, {
          field: "barcode",
          suggestedFix:
            "отформатируйте колонку штрих-кода как текст и перевыгрузите файл",
        }),
      )
    } else {
      errors.push(issue(rowNumber, `штрих-код не 4-14 цифр (${barcodeRaw})`, { field: "barcode" }))
    }
  }

  // unit: null -> PCS (default как в MTM), неизвестное значение -> error
  const unitRaw = get("unit")
  const unit = parseUnit(unitRaw)
  if (unit == null) {
    errors.push(
      issue(rowNumber, `неизвестная единица измерения "${unitRaw}"`, {
        field: "unit",
        suggestedFix: `допустимо: ${KNOWN_UNIT_INPUTS.slice(0, 10).join(", ")}...`,
      }),
    )
  }

  // Габариты: отсутствие -> warning (статус «размеры отсутствуют»), мусор/<=0 -> error
  const dims: Record<(typeof DIMENSION_FIELDS)[number], number | null> = {
    widthMm: null,
    heightMm: null,
    depthMm: null,
    weightG: null,
  }
  for (const field of DIMENSION_FIELDS) {
    const rawVal = get(field)
    if (rawVal == null) continue
    const n = parseInteger(rawVal)
    if (n == null || n <= 0) {
      errors.push(
        issue(rowNumber, `${field}: ожидается целое положительное число, получено "${rawVal}"`, {
          field,
        }),
      )
    } else {
      dims[field] = n
    }
  }
  if (dims.widthMm == null || dims.heightMm == null || dims.depthMm == null) {
    warnings.push(
      issue(rowNumber, "размеры неполные — товар не встанет на планограмму", {
        field: "widthMm",
        severity: "warning",
        suggestedFix: "заполнить в UI обмера (Каталог -> без размеров)",
      }),
    )
  }

  // isActive: default true
  let isActive = true
  const activeRaw = get("isActive")
  if (activeRaw != null) {
    const parsed = parseBool(activeRaw)
    if (parsed == null) {
      errors.push(issue(rowNumber, `isActive: не распознано "${activeRaw}"`, { field: "isActive" }))
    } else {
      isActive = parsed
    }
  }

  // isSoftPack: default false; only explicit true enables auto-compression.
  let isSoftPack = false
  const softPackRaw = get("isSoftPack")
  if (softPackRaw != null) {
    const parsed = parseBool(softPackRaw)
    if (parsed == null) {
      errors.push(issue(rowNumber, `isSoftPack: не распознано "${softPackRaw}"`, { field: "isSoftPack" }))
    } else {
      isSoftPack = parsed
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  const candidate = {
    sku: normalizeSku(skuRaw!),
    name: normalizeName(name!),
    barcode,
    categoryPath: get("categoryPath"),
    categoryCode: get("categoryCode"),
    brandName: get("brandName") ? normalizeName(get("brandName")!) : null,
    supplierName: get("supplierName") ? normalizeName(get("supplierName")!) : null,
    manufacturerName: get("manufacturerName") ? normalizeName(get("manufacturerName")!) : null,
    unit: unit!,
    ...dims,
    externalId: get("externalId"),
    isSoftPack,
    isActive,
  }

  const validated = productImportRowV1.safeParse(candidate)
  if (!validated.success) {
    return {
      ok: false,
      errors: validated.error.issues.map((i) =>
        issue(rowNumber, i.message, { field: i.path.join(".") || undefined }),
      ),
      warnings,
    }
  }
  return { ok: true, value: validated.data, warnings }
}
