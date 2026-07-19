import type { RetentionPreview, RetentionResult } from "./retention"

export function safeRetentionPreviewOutput(preview: RetentionPreview) {
  return {
    event: "retention_preview_completed",
    policy: preview.policy,
    cutoffs: preview.cutoffs,
    affected: preview.affected,
    mediaManifestDigest: preview.mediaManifestDigest,
  }
}

export function safeRetentionExecuteOutput(result: RetentionResult) {
  return {
    event: "retention_execute_completed",
    auditEventId: result.auditEventId,
    policy: result.policy,
    deleted: result.deleted,
    redacted: result.redacted,
    mediaManifestDigest: result.mediaManifestDigest,
  }
}

export function safeRetentionFailureOutput() {
  return { event: "retention_failed", code: "retention_rejected" }
}
