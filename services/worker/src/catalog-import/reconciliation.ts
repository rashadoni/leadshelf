import { createHash } from "node:crypto"
import {
  parsePriceRow,
  parseSalesRow,
  parseStockRow,
  type RawCsvRow,
} from "@leadshelf/core"

export type ImportReconciliation = {
  status: "MATCH" | "MISMATCH"
  sourceRows: number
  importedRows: number
  errorRows: number
  sourceChecksum: string
  sourceTotals?: Record<string, string>
  expectedTotals?: Record<string, string>
  mismatches: string[]
}

type SnapshotEntity = "prices" | "stock" | "sales"

function parseExactDecimal(value: string): { coefficient: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error(`invalid canonical decimal: ${value}`)
  const fraction = match[3] ?? ""
  const coefficient = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`)
  return { coefficient, scale: fraction.length }
}

function formatExactDecimal(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return "0"
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0")
  if (scale === 0) return `${negative ? "-" : ""}${digits}`
  const integer = digits.slice(0, -scale)
  const fraction = digits.slice(-scale).replace(/0+$/, "")
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`
}

export function sumExactDecimals(values: Array<string | null | undefined>): string {
  const parsed = values.filter((value): value is string => value != null).map(parseExactDecimal)
  if (parsed.length === 0) return "0"
  const scale = Math.max(...parsed.map((value) => value.scale))
  const total = parsed.reduce(
    (sum, value) => sum + value.coefficient * 10n ** BigInt(scale - value.scale),
    0n,
  )
  return formatExactDecimal(total, scale)
}

export function buildSnapshotSourceTotals(
  entityType: SnapshotEntity,
  rows: RawCsvRow[],
): Record<string, string> {
  if (entityType === "prices") {
    const parsed = rows.map((row, index) => parsePriceRow(row, index + 2)).filter((result) => result.ok)
    return {
      price: sumExactDecimals(parsed.map((result) => result.value.price)),
      costPrice: sumExactDecimals(parsed.map((result) => result.value.costPrice)),
    }
  }
  if (entityType === "stock") {
    const parsed = rows.map((row, index) => parseStockRow(row, index + 2)).filter((result) => result.ok)
    return { quantity: sumExactDecimals(parsed.map((result) => result.value.quantity)) }
  }
  const parsed = rows.map((row, index) => parseSalesRow(row, index + 2)).filter((result) => result.ok)
  return {
    quantity: sumExactDecimals(parsed.map((result) => result.value.quantity)),
    revenue: sumExactDecimals(parsed.map((result) => result.value.revenue)),
    profit: sumExactDecimals(parsed.map((result) => result.value.profit)),
  }
}

function canonicalRow(row: RawCsvRow): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key] ?? ""]),
  )
}

export function checksumImportRows(rows: RawCsvRow[]): string {
  const canonicalRows = rows.map(canonicalRow).sort()
  return createHash("sha256").update(JSON.stringify(canonicalRows)).digest("hex")
}

export function buildImportReconciliation(input: {
  rows: RawCsvRow[]
  importedRows: number
  errorRows: number
  expectedRows?: number
  expectedChecksum?: string
  sourceTotals?: Record<string, string>
  expectedTotals?: Record<string, string>
  processedRows: number
}): ImportReconciliation {
  const sourceChecksum = checksumImportRows(input.rows)
  const mismatches: string[] = []
  if (input.processedRows !== input.rows.length) {
    mismatches.push("processed_row_count_mismatch")
  }
  if (input.expectedRows != null && input.expectedRows !== input.rows.length) {
    mismatches.push("erp_row_count_mismatch")
  }
  if (input.expectedChecksum && input.expectedChecksum.toLowerCase() !== sourceChecksum) {
    mismatches.push("erp_checksum_mismatch")
  }
  if (input.expectedTotals) {
    for (const [field, expected] of Object.entries(input.expectedTotals).sort(([a], [b]) => a.localeCompare(b))) {
      const actual = input.sourceTotals?.[field]
      if (actual == null || sumExactDecimals([expected]) !== sumExactDecimals([actual])) {
        mismatches.push(`erp_total_${field}_mismatch`)
      }
    }
  }
  return {
    status: mismatches.length === 0 ? "MATCH" : "MISMATCH",
    sourceRows: input.rows.length,
    importedRows: input.importedRows,
    errorRows: input.errorRows,
    sourceChecksum,
    ...(input.sourceTotals ? { sourceTotals: input.sourceTotals } : {}),
    ...(input.expectedTotals ? { expectedTotals: input.expectedTotals } : {}),
    mismatches,
  }
}

export function guardDestructiveFullSync(input: {
  currentActiveRows: number
  incomingActiveRows: number
  confirmed: boolean
  maxDropRatio?: number
}): { allowed: true } | { allowed: false; reason: "mass_zero" | "mass_drop"; dropRatio: number } {
  const current = Math.max(0, input.currentActiveRows)
  const incoming = Math.max(0, input.incomingActiveRows)
  const dropRatio = current === 0 ? 0 : Math.max(0, (current - incoming) / current)
  if (input.confirmed) return { allowed: true }
  if (current > 0 && incoming === 0) return { allowed: false, reason: "mass_zero", dropRatio }
  if (dropRatio > (input.maxDropRatio ?? 0.1)) {
    return { allowed: false, reason: "mass_drop", dropRatio }
  }
  return { allowed: true }
}
