import { describe, expect, it } from "vitest"
import {
  buildImportReconciliation,
  buildSnapshotSourceTotals,
  checksumImportRows,
  guardDestructiveFullSync,
  signDestructiveFullSyncApproval,
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

  it("requires a signed tenant/checksum/count/expiry-bound approval for a destructive full sync", () => {
    const now = new Date("2026-07-19T05:00:00.000Z")
    const secret = "full-sync-test-secret-at-least-32-bytes"
    const sourceChecksum = "a".repeat(64)
    const context = {
      organizationId: "org-full-sync",
      entityType: "products" as const,
      sourceChecksum,
      currentActiveRows: 100,
      incomingActiveRows: 80,
      now,
    }
    const payload = {
      version: 1 as const,
      action: "deactivate_absent_products" as const,
      changeId: "CHG-2026-001",
      requesterApprovalId: "approval-requester-001",
      reviewerApprovalId: "approval-reviewer-001",
      reasonCode: "catalog-authoritative-full-sync",
      organizationId: context.organizationId,
      entityType: context.entityType,
      sourceChecksum,
      currentActiveRows: context.currentActiveRows,
      incomingActiveRows: context.incomingActiveRows,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    }
    const approvalToken = signDestructiveFullSyncApproval(payload, secret)

    expect(guardDestructiveFullSync(context)).toMatchObject({ allowed: false, reason: "mass_drop" })
    expect(guardDestructiveFullSync({ ...context, incomingActiveRows: 0 })).toMatchObject({ allowed: false, reason: "mass_zero" })
    expect(guardDestructiveFullSync({ ...context, incomingActiveRows: 90 })).toEqual({ allowed: true })
    expect(guardDestructiveFullSync({ ...context, approvalToken, approvalSecret: secret })).toEqual({
      allowed: true,
      changeId: payload.changeId,
    })

    const tampered = `${approvalToken.slice(0, -1)}${approvalToken.endsWith("A") ? "B" : "A"}`
    expect(guardDestructiveFullSync({ ...context, approvalToken: tampered, approvalSecret: secret })).toMatchObject({
      allowed: false,
      reason: "approval_invalid",
    })
    expect(guardDestructiveFullSync({ ...context, approvalToken, approvalSecret: "wrong-secret-that-is-still-at-least-32-bytes" })).toMatchObject({
      allowed: false,
      reason: "approval_invalid",
    })

    for (const mismatch of [
      { organizationId: "neighbor-tenant" },
      { sourceChecksum: "b".repeat(64) },
      { currentActiveRows: 101 },
      { incomingActiveRows: 79 },
    ]) {
      expect(guardDestructiveFullSync({ ...context, ...mismatch, approvalToken, approvalSecret: secret })).toMatchObject({
        allowed: false,
        reason: "approval_mismatch",
      })
    }

    const expiredPayload = {
      ...payload,
      issuedAt: new Date(now.getTime() - 60 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    }
    expect(guardDestructiveFullSync({
      ...context,
      approvalToken: signDestructiveFullSyncApproval(expiredPayload, secret),
      approvalSecret: secret,
    })).toMatchObject({ allowed: false, reason: "approval_expired" })

    const futurePayload = {
      ...payload,
      issuedAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 32 * 60_000).toISOString(),
    }
    expect(guardDestructiveFullSync({
      ...context,
      approvalToken: signDestructiveFullSyncApproval(futurePayload, secret),
      approvalSecret: secret,
    })).toMatchObject({ allowed: false, reason: "approval_expired" })

    expect(() => signDestructiveFullSyncApproval(payload, "short-secret")).toThrow("full_sync_approval_secret_invalid")
    expect(() => signDestructiveFullSyncApproval({
      ...payload,
      expiresAt: new Date(now.getTime() + 61 * 60_000).toISOString(),
    }, secret)).toThrow("full_sync_approval_payload_invalid")
    expect(() => signDestructiveFullSyncApproval({
      ...payload,
      reviewerApprovalId: payload.requesterApprovalId,
    }, secret)).toThrow("full_sync_approval_payload_invalid")
    expect(guardDestructiveFullSync({ ...context, sourceChecksum: "bad" })).toMatchObject({
      allowed: false,
      reason: "input_invalid",
    })
    expect(guardDestructiveFullSync({
      ...context,
      approvalToken,
      approvalSecret: secret,
      now: new Date(Number.NaN),
    })).toMatchObject({ allowed: false, reason: "input_invalid" })
  })
})
