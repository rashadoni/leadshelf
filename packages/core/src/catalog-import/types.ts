// Результаты построчного парсинга staging-импорта.
// Паттерн портирован из MTM parse-sku-csv-row: чистые функции, без throw,
// накопление ошибок по строке — endpoint собирает ImportError-ы пачкой.

export type RawCsvRow = Record<string, string | undefined>

export interface RowIssue {
  rowNumber: number
  field?: string
  reason: string
  severity: "error" | "warning"
  suggestedFix?: string
}

export type ParseResult<T> =
  | { ok: true; value: T; warnings: RowIssue[] }
  | { ok: false; errors: RowIssue[]; warnings: RowIssue[] }

export function issue(
  rowNumber: number,
  reason: string,
  opts: { field?: string; severity?: "error" | "warning"; suggestedFix?: string } = {},
): RowIssue {
  return {
    rowNumber,
    reason,
    field: opts.field,
    severity: opts.severity ?? "error",
    suggestedFix: opts.suggestedFix,
  }
}
