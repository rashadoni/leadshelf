import { describe, expect, it } from "vitest"
import { fullSyncRequestsEnabled, parseCatalogImportManifest } from "./import-manifest"

describe("catalog import manifest", () => {
  it("accepts and normalizes a valid sales manifest", () => {
    expect(parseCatalogImportManifest("sales", {
      expectedRows: "42",
      expectedChecksum: "A".repeat(64),
      expectedTotals: JSON.stringify({ quantity: "1.20", revenue: "100.01", profit: "-3.5" }),
    })).toEqual({
      success: true,
      data: {
        syncMode: "delta",
        expectedRows: 42,
        expectedChecksum: "a".repeat(64),
        expectedTotals: { quantity: "1.20", revenue: "100.01", profit: "-3.5" },
      },
    })
  })

  it("rejects malformed and inapplicable totals", () => {
    expect(parseCatalogImportManifest("products", {
      expectedRows: null,
      expectedChecksum: null,
      expectedTotals: JSON.stringify({ revenue: "1" }),
    })).toEqual({ success: false, reason: "expected_totals_not_applicable" })
    expect(parseCatalogImportManifest("stock", {
      expectedRows: "1.5",
      expectedChecksum: null,
      expectedTotals: null,
    })).toEqual({ success: false, reason: "expected_rows_invalid" })
  })

  it("requires an exact products manifest for full sync", () => {
    expect(parseCatalogImportManifest("products", {
      expectedRows: "1",
      expectedChecksum: "b".repeat(64),
      expectedTotals: null,
      syncMode: "full",
    })).toEqual({
      success: true,
      data: { syncMode: "full", expectedRows: 1, expectedChecksum: "b".repeat(64) },
    })
    expect(parseCatalogImportManifest("products", {
      expectedRows: null,
      expectedChecksum: null,
      expectedTotals: null,
      syncMode: "full",
    })).toEqual({ success: false, reason: "full_sync_manifest_required" })
    expect(parseCatalogImportManifest("stock", {
      expectedRows: "1",
      expectedChecksum: "b".repeat(64),
      expectedTotals: null,
      syncMode: "full",
    })).toEqual({ success: false, reason: "full_sync_entity_not_supported" })
    expect(parseCatalogImportManifest("products", {
      expectedRows: "1",
      expectedChecksum: "b".repeat(64),
      expectedTotals: null,
      syncMode: "replace",
    })).toEqual({ success: false, reason: "sync_mode_invalid" })
  })

  it("enables full-sync requests only for the exact explicit opt-in", () => {
    expect(fullSyncRequestsEnabled({})).toBe(false)
    expect(fullSyncRequestsEnabled({ LEADSHELF_FULL_SYNC_REQUESTS_ENABLED: "false" })).toBe(false)
    expect(fullSyncRequestsEnabled({ LEADSHELF_FULL_SYNC_REQUESTS_ENABLED: "TRUE" })).toBe(false)
    expect(fullSyncRequestsEnabled({ LEADSHELF_FULL_SYNC_REQUESTS_ENABLED: "true" })).toBe(true)
  })
})
