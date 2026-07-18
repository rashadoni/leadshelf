import { describe, expect, it } from "vitest"
import {
  buildImportReconciliation,
  buildSnapshotSourceTotals,
  checksumImportRows,
  guardDestructiveFullSync,
  sumExactDecimals,
} from "./reconciliation"

describe("ERP import reconciliation", () => {
  const rows = [
    { sku: "B", quantity: "2" },
    { quantity: "1", sku: "A" },
  ]

  it("checksum is deterministic across row and key order", () => {
    expect(checksumImportRows(rows)).toBe(checksumImportRows([
      { sku: "A", quantity: "1" },
      { quantity: "2", sku: "B" },
    ]))
  })

  it("reports matching counts/checksum", () => {
    const checksum = checksumImportRows(rows)
    expect(buildImportReconciliation({
      rows,
      importedRows: 2,
      processedRows: 2,
      errorRows: 0,
      expectedRows: 2,
      expectedChecksum: checksum,
    })).toMatchObject({ status: "MATCH", mismatches: [] })
  })

  it("reports unexplained and ERP mismatches", () => {
    expect(buildImportReconciliation({
      rows,
      importedRows: 0,
      errorRows: 1,
      processedRows: 1,
      expectedRows: 3,
      expectedChecksum: "bad",
    }).mismatches).toEqual([
      "processed_row_count_mismatch",
      "erp_row_count_mismatch",
      "erp_checksum_mismatch",
    ])
  })

  it("sums canonical decimals exactly without floating point loss", () => {
    expect(sumExactDecimals(["0.1", "0.2", "-0.03", null])).toBe("0.27")
    expect(sumExactDecimals(["1.2300", "-1.23"])).toBe("0")
  })

  it("builds parser-normalized snapshot totals and reports field mismatch", () => {
    const salesRows = [
      { sku: "A", date: "2026-07-01", quantity: "1,5", revenue: "10,20", profit: "-2.1" },
      { sku: "B", date: "2026-07-01", quantity: "-0.5", revenue: "0.80", profit: "3.10" },
      { sku: "C", date: "bad", quantity: "100", revenue: "100", profit: "100" },
    ]
    const sourceTotals = buildSnapshotSourceTotals("sales", salesRows)
    expect(sourceTotals).toEqual({ quantity: "1", revenue: "11", profit: "1" })
    expect(buildImportReconciliation({
      rows: salesRows,
      importedRows: 2,
      errorRows: 1,
      processedRows: 3,
      sourceTotals,
      expectedTotals: { quantity: "1.00", revenue: "12", profit: "1" },
    })).toMatchObject({
      status: "MISMATCH",
      sourceTotals,
      expectedTotals: { quantity: "1.00", revenue: "12", profit: "1" },
      mismatches: ["erp_total_revenue_mismatch"],
    })
  })

  it("blocks mass zero/drop until explicit confirmation", () => {
    expect(guardDestructiveFullSync({ currentActiveRows: 100, incomingActiveRows: 0, confirmed: false })).toMatchObject({ allowed: false, reason: "mass_zero" })
    expect(guardDestructiveFullSync({ currentActiveRows: 100, incomingActiveRows: 80, confirmed: false })).toMatchObject({ allowed: false, reason: "mass_drop" })
    expect(guardDestructiveFullSync({ currentActiveRows: 100, incomingActiveRows: 95, confirmed: false })).toEqual({ allowed: true })
    expect(guardDestructiveFullSync({ currentActiveRows: 100, incomingActiveRows: 0, confirmed: true })).toEqual({ allowed: true })
  })
})
