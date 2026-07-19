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
  syncMode: "delta" | "full"
}

export function fullSyncRequestsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.LEADSHELF_FULL_SYNC_REQUESTS_ENABLED === "true"
}

export function parseCatalogImportManifest(
  entityType: CatalogImportEntity,
  input: {
    expectedRows: FormDataEntryValue | null
    expectedChecksum: FormDataEntryValue | null
    expectedTotals: FormDataEntryValue | null
    syncMode?: FormDataEntryValue | null
  },
): { success: true; data: CatalogImportManifest } | { success: false; reason: string } {
  const rowsRaw = input.expectedRows
  const checksumRaw = input.expectedChecksum
  const totalsRaw = input.expectedTotals
  const syncModeRaw = input.syncMode
  if (rowsRaw instanceof File || checksumRaw instanceof File || totalsRaw instanceof File || syncModeRaw instanceof File) {
    return { success: false, reason: "manifest_fields_must_be_text" }
  }

  if (syncModeRaw != null && syncModeRaw !== "" && syncModeRaw !== "delta" && syncModeRaw !== "full") {
    return { success: false, reason: "sync_mode_invalid" }
  }
  const result: CatalogImportManifest = { syncMode: syncModeRaw === "full" ? "full" : "delta" }
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
  if (result.syncMode === "full") {
    if (entityType !== "products") return { success: false, reason: "full_sync_entity_not_supported" }
    if (result.expectedRows == null || result.expectedChecksum == null) {
      return { success: false, reason: "full_sync_manifest_required" }
    }
  }
  return { success: true, data: result }
}
