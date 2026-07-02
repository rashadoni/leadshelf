import {
  assortmentImportRowV1,
  type AssortmentImportRowV1,
} from "@leadshelf/api-contracts/import/v1"
import { canonicalizeRow } from "./headers"
import { cleanCell, normalizeName, parseBool, parseDateOnly } from "./primitives"
import { extractProductRef } from "./row-helpers"
import { issue, type ParseResult, type RawCsvRow, type RowIssue } from "./types"

const SCOPE_MAP: Record<string, "format" | "store"> = {
  format: "format",
  формат: "format",
  store: "store",
  точка: "store",
  магазин: "store",
  mağaza: "store",
  magaza: "store",
}

export function parseAssortmentRow(
  raw: RawCsvRow,
  rowNumber: number,
): ParseResult<AssortmentImportRowV1> {
  const row = canonicalizeRow(raw)
  const errors: RowIssue[] = []
  const ref = extractProductRef(row, rowNumber, errors)

  const scopeRaw = cleanCell(row.scope)
  const scope = scopeRaw ? SCOPE_MAP[scopeRaw.toLowerCase()] : undefined
  if (!scope) {
    errors.push(
      issue(rowNumber, `scope: ожидается format|store, получено "${scopeRaw}"`, {
        field: "scope",
      }),
    )
  }

  let isActive = true
  const activeRaw = cleanCell(row.isActive)
  if (activeRaw != null) {
    const parsed = parseBool(activeRaw)
    if (parsed == null) {
      errors.push(issue(rowNumber, `isActive: не распознано "${activeRaw}"`, { field: "isActive" }))
    } else {
      isActive = parsed
    }
  }

  const parseOptionalDate = (field: "validFrom" | "validTo"): string | null => {
    const rawVal = cleanCell(row[field])
    if (rawVal == null) return null
    const parsed = parseDateOnly(rawVal)
    if (parsed == null) {
      errors.push(issue(rowNumber, `${field}: дата не распознана "${rawVal}"`, { field }))
    }
    return parsed
  }
  const validFrom = parseOptionalDate("validFrom")
  const validTo = parseOptionalDate("validTo")

  if (errors.length > 0) return { ok: false, errors, warnings: [] }

  const formatNameRaw = cleanCell(row.formatName)
  const validated = assortmentImportRowV1.safeParse({
    ...ref,
    scope,
    formatName: formatNameRaw ? normalizeName(formatNameRaw) : null,
    storeCode: cleanCell(row.storeCode),
    isActive,
    validFrom,
    validTo,
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
