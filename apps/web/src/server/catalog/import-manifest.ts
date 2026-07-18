import { z } from "zod"

export type CatalogImportEntity = "products" | "prices" | "stock" | "sales" | "assortment"

const decimal = z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).max(100)
const totalsSchema = z.object({
  price: decimal.optional(),
  costPrice: decimal.optional(),
  quantity: decimal.optional(),
  revenue: decimal.optional(),
  profit: decimal.optional(),
}).strict()

const allowedTotals: Record<CatalogImportEntity, ReadonlySet<string>> = {
  products: new Set(),
  assortment: new Set(),
  prices: new Set(["price", "costPrice"]),
  stock: new Set(["quantity"]),
  sales: new Set(["quantity", "revenue", "profit"]),
}

export type CatalogImportManifest = {
  expectedRows?: number
  expectedChecksum?: string
  expectedTotals?: Record<string, string>
}

export function parseCatalogImportManifest(
  entityType: CatalogImportEntity,
  input: { expectedRows: FormDataEntryValue | null; expectedChecksum: FormDataEntryValue | null; expectedTotals: FormDataEntryValue | null },
): { success: true; data: CatalogImportManifest } | { success: false; reason: string } {
  const rowsRaw = input.expectedRows
  const checksumRaw = input.expectedChecksum
  const totalsRaw = input.expectedTotals
  if (rowsRaw instanceof File || checksumRaw instanceof File || totalsRaw instanceof File) {
    return { success: false, reason: "manifest_fields_must_be_text" }
  }

  const result: CatalogImportManifest = {}
  if (rowsRaw != null && rowsRaw !== "") {
    if (!/^\d+$/.test(rowsRaw)) return { success: false, reason: "expected_rows_invalid" }
    const expectedRows = Number(rowsRaw)
    if (!Number.isSafeInteger(expectedRows) || expectedRows > 10_000_000) {
      return { success: false, reason: "expected_rows_invalid" }
    }
    result.expectedRows = expectedRows
  }
  if (checksumRaw != null && checksumRaw !== "") {
    if (!/^[a-fA-F0-9]{64}$/.test(checksumRaw)) return { success: false, reason: "expected_checksum_invalid" }
    result.expectedChecksum = checksumRaw.toLowerCase()
  }
  if (totalsRaw != null && totalsRaw !== "") {
    if (totalsRaw.length > 2_000) return { success: false, reason: "expected_totals_invalid" }
    let decoded: unknown
    try {
      decoded = JSON.parse(totalsRaw)
    } catch {
      return { success: false, reason: "expected_totals_invalid" }
    }
    const parsed = totalsSchema.safeParse(decoded)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return { success: false, reason: "expected_totals_invalid" }
    }
    if (Object.keys(parsed.data).some((key) => !allowedTotals[entityType].has(key))) {
      return { success: false, reason: "expected_totals_not_applicable" }
    }
    result.expectedTotals = parsed.data as Record<string, string>
  }
  return { success: true, data: result }
}
