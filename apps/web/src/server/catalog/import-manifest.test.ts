import { describe, expect, it } from "vitest"
import { parseCatalogImportManifest } from "./import-manifest"

describe("catalog import manifest", () => {
  it("accepts and normalizes a valid sales manifest", () => {
    expect(parseCatalogImportManifest("sales", {
      expectedRows: "42",
      expectedChecksum: "A".repeat(64),
      expectedTotals: JSON.stringify({ quantity: "1.20", revenue: "100.01", profit: "-3.5" }),
    })).toEqual({
      success: true,
      data: {
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
})
