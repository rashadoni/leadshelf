import { describe, expect, it } from "vitest"

import {
  safeRetentionExecuteOutput,
  safeRetentionFailureOutput,
  safeRetentionPreviewOutput,
} from "../retention-cli-output"

describe("retention CLI output boundary", () => {
  it("omits tenant identity, object keys, receipts and raw errors", () => {
    const privateValues = [
      "private-org-id", "private-tenant-slug", "Private Tenant", "photos/private-org-id/private.jpg",
      "backup:private", "legal-hold:private", "media:private", "raw database error private@example.test",
    ]
    const preview = safeRetentionPreviewOutput({
      organization: { id: privateValues[0]!, slug: privateValues[1]!, name: privateValues[2]! },
      policy: { asOf: "2026-07-19T06:00:00.000Z", mediaDays: 30, gpsDays: 14, auditDays: 90 },
      cutoffs: { media: "2026-06-19T06:00:00.000Z", gps: "2026-07-05T06:00:00.000Z", audit: "2026-04-20T06:00:00.000Z" },
      affected: {
        mediaRows: 1, gpsLocationRows: 0, gpsVisitRows: 0, gpsPhotoMetadataRows: 0,
        gpsEventPayloadRows: 0, gpsAlertPayloadRows: 0, auditRows: 1, goldenReferenceBlockedRows: 0,
      },
      mediaReferences: [privateValues[3]!],
      mediaManifestDigest: "a".repeat(64),
    })
    const execute = safeRetentionExecuteOutput({
      auditEventId: "audit-safe-001",
      organizationId: privateValues[0]!,
      slug: privateValues[1]!,
      policy: preview.policy,
      changeId: "private-change-id",
      reasonCode: "private-reason-code",
      deleted: { mediaRows: 1, gpsLocationRows: 0, auditRows: 1 },
      redacted: { gpsVisitRows: 0, gpsPhotoMetadataRows: 0, gpsEventPayloadRows: 0, gpsAlertPayloadRows: 0 },
      backupReceipt: privateValues[4]!,
      legalHoldClearanceReceipt: privateValues[5]!,
      mediaDeletionReceipt: privateValues[6]!,
      mediaManifestDigest: "a".repeat(64),
    })
    const serialized = JSON.stringify([preview, execute, safeRetentionFailureOutput()])
    for (const value of privateValues) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain("private-change-id")
    expect(serialized).not.toContain("private-reason-code")
    expect(serialized).toContain("retention_preview_completed")
    expect(serialized).toContain("retention_execute_completed")
    expect(serialized).toContain("retention_rejected")
  })
})
