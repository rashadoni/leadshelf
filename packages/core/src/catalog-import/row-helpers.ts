import { cleanCell, normalizeSku, parseBarcode, parseDateOnly } from "./primitives"
import { issue, type RawCsvRow, type RowIssue } from "./types"

/** Общее для снапшотов/ассортимента: идентификация товара по sku ИЛИ barcode. */
export function extractProductRef(
  row: RawCsvRow,
  rowNumber: number,
  errors: RowIssue[],
): { sku: string | null; barcode: string | null } {
  const skuRaw = cleanCell(row.sku)
  const barcodeRaw = cleanCell(row.barcode)
  let barcode: string | null = null
  if (barcodeRaw != null) {
    const parsed = parseBarcode(barcodeRaw)
    if (parsed.ok) barcode = parsed.barcode
    else if (skuRaw == null) {
      // barcode — единственный идентификатор и он битый -> error
      errors.push(
        issue(rowNumber, `штрих-код нечитаем (${barcodeRaw})`, {
          field: "barcode",
          suggestedFix:
            parsed.reason === "excel_mangled"
              ? "отформатируйте колонку как текст и перевыгрузите"
              : undefined,
        }),
      )
    }
  }
  const sku = skuRaw ? normalizeSku(skuRaw) : null
  if (!sku && !barcode) {
    errors.push(issue(rowNumber, "нужен sku или barcode", { field: "sku" }))
  }
  return { sku, barcode }
}

export function extractDate(
  row: RawCsvRow,
  rowNumber: number,
  errors: RowIssue[],
): string | null {
  const raw = cleanCell(row.date)
  if (!raw) {
    errors.push(issue(rowNumber, "date обязательна", { field: "date" }))
    return null
  }
  const date = parseDateOnly(raw)
  if (!date) {
    errors.push(
      issue(rowNumber, `дата не распознана "${raw}"`, {
        field: "date",
        suggestedFix: "форматы: 2026-07-02 или 02.07.2026",
      }),
    )
  }
  return date
}
