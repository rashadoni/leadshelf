import {
  priceImportRowV1,
  salesImportRowV1,
  stockImportRowV1,
  type PriceImportRowV1,
  type SalesImportRowV1,
  type StockImportRowV1,
} from "@leadshelf/api-contracts/import/v1"
import { canonicalizeRow } from "./headers"
import { cleanCell, parseDecimal } from "./primitives"
import { extractDate, extractProductRef } from "./row-helpers"
import { issue, type ParseResult, type RawCsvRow, type RowIssue } from "./types"

function decimalField(
  row: RawCsvRow,
  field: string,
  rowNumber: number,
  errors: RowIssue[],
  opts: { required?: boolean; nonNegative?: boolean } = {},
): string | null {
  const raw = cleanCell(row[field])
  if (raw == null) {
    if (opts.required) errors.push(issue(rowNumber, `${field} обязательно`, { field }))
    return null
  }
  const parsed = parseDecimal(raw)
  if (parsed == null) {
    errors.push(issue(rowNumber, `${field}: число не распознано "${raw}"`, { field }))
    return null
  }
  if (opts.nonNegative && parsed.startsWith("-")) {
    errors.push(issue(rowNumber, `${field}: отрицательное значение`, { field }))
    return null
  }
  return parsed
}

export function parsePriceRow(
  raw: RawCsvRow,
  rowNumber: number,
): ParseResult<PriceImportRowV1> {
  const row = canonicalizeRow(raw)
  const errors: RowIssue[] = []
  const ref = extractProductRef(row, rowNumber, errors)
  const date = extractDate(row, rowNumber, errors)
  const price = decimalField(row, "price", rowNumber, errors, {
    required: true,
    nonNegative: true,
  })
  const costPrice = decimalField(row, "costPrice", rowNumber, errors, { nonNegative: true })
  if (errors.length > 0) return { ok: false, errors, warnings: [] }

  const validated = priceImportRowV1.safeParse({
    ...ref,
    date,
    storeCode: cleanCell(row.storeCode),
    price,
    costPrice,
    currency: cleanCell(row.currency) ?? "AZN",
  })
  if (!validated.success) {
    return {
      ok: false,
      errors: validated.error.issues.map((i) =>
        issue(rowNumber, i.message, { field: i.path.join(".") || undefined }),
      ),
      warnings: [],
    }
  }
  return { ok: true, value: validated.data, warnings: [] }
}

export function parseStockRow(
  raw: RawCsvRow,
  rowNumber: number,
): ParseResult<StockImportRowV1> {
  const row = canonicalizeRow(raw)
  const errors: RowIssue[] = []
  const ref = extractProductRef(row, rowNumber, errors)
  const date = extractDate(row, rowNumber, errors)
  const quantity = decimalField(row, "quantity", rowNumber, errors, { required: true })
  if (errors.length > 0) return { ok: false, errors, warnings: [] }

  const validated = stockImportRowV1.safeParse({
    ...ref,
    date,
    storeCode: cleanCell(row.storeCode),
    warehouseCode: cleanCell(row.warehouseCode),
    quantity,
  })
  if (!validated.success) {
    return {
      ok: false,
      errors: validated.error.issues.map((i) =>
        issue(rowNumber, i.message, { field: i.path.join(".") || undefined }),
      ),
      warnings: [],
    }
  }
  return { ok: true, value: validated.data, warnings: [] }
}

export function parseSalesRow(
  raw: RawCsvRow,
  rowNumber: number,
): ParseResult<SalesImportRowV1> {
  const row = canonicalizeRow(raw)
  const errors: RowIssue[] = []
  const ref = extractProductRef(row, rowNumber, errors)
  const date = extractDate(row, rowNumber, errors)
  const quantity = decimalField(row, "quantity", rowNumber, errors, { required: true })
  const revenue = decimalField(row, "revenue", rowNumber, errors, {
    required: true,
    nonNegative: true,
  })
  const profit = decimalField(row, "profit", rowNumber, errors, {})
  if (errors.length > 0) return { ok: false, errors, warnings: [] }

  const validated = salesImportRowV1.safeParse({
    ...ref,
    date,
    storeCode: cleanCell(row.storeCode),
    quantity,
    revenue,
    profit,
  })
  if (!validated.success) {
    return {
      ok: false,
      errors: validated.error.issues.map((i) =>
        issue(rowNumber, i.message, { field: i.path.join(".") || undefined }),
      ),
      warnings: [],
    }
  }
  return { ok: true, value: validated.data, warnings: [] }
}
