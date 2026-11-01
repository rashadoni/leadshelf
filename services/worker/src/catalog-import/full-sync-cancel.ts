import type { PrismaClient } from "@leadshelf/prisma-client"
import { realpath } from "node:fs/promises"
import path from "node:path"

import { readProtectedFullSyncFile, unlinkProtectedFullSyncFile } from "./full-sync-approval"

export type FullSyncCancelErrorCode =
  | "control_invalid"
  | "job_not_waiting"
  | "cancellation_context_mismatch"
  | "cleanup_failed"

export class FullSyncCancelError extends Error {
  constructor(readonly code: FullSyncCancelErrorCode) {
    super(code)
    this.name = "FullSyncCancelError"
  }
}

function fail(code: FullSyncCancelErrorCode): never {
  throw new FullSyncCancelError(code)
}

export type FullSyncCancelControl = {
  organizationId: string
  jobId: string
  changeId: string
  requesterApprovalId: string
  reviewerApprovalId: string
  reasonCode: string
  confirmation: string
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function validateControl(value: Record<string, unknown>): FullSyncCancelControl {
  const keys = [
    "changeId", "confirmation", "jobId", "organizationId", "reasonCode",
    "requesterApprovalId", "reviewerApprovalId",
  ]
  if (Object.keys(value).sort().join("\0") !== keys.join("\0")) fail("control_invalid")
  for (const key of [
    "changeId", "jobId", "organizationId", "reasonCode", "requesterApprovalId", "reviewerApprovalId",
  ] as const) {
    if (!validIdentifier(value[key])) fail("control_invalid")
  }
  if (value.requesterApprovalId === value.reviewerApprovalId) fail("control_invalid")
  if (value.confirmation !== `CANCEL FULL SYNC ${value.jobId} ${value.organizationId}`) fail("control_invalid")
  return value as FullSyncCancelControl
}

export async function readFullSyncCancelControlFile(
  filePath: string,
  expectedUid?: number,
): Promise<FullSyncCancelControl> {
  const uid = expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("control_invalid")
  let raw: unknown
  try {
    raw = JSON.parse((await readProtectedFullSyncFile(filePath, Number(uid), 16 * 1024)).toString("utf8"))
  } catch {
    fail("control_invalid")
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("control_invalid")
  return validateControl(raw as Record<string, unknown>)
}

function importQueueDir(): string {
  return path.resolve(process.env.LEADSHELF_IMPORT_QUEUE_DIR ?? path.join(process.cwd(), ".data", "import-queue"))
}

export async function cancelPendingFullSyncJob(
  prisma: PrismaClient,
  input: FullSyncCancelControl & { expectedUid?: number; now?: Date },
): Promise<{ cleanup: "completed" }> {
  validateControl({
    organizationId: input.organizationId,
    jobId: input.jobId,
    changeId: input.changeId,
    requesterApprovalId: input.requesterApprovalId,
    reviewerApprovalId: input.reviewerApprovalId,
    reasonCode: input.reasonCode,
    confirmation: input.confirmation,
  })
  const uid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("control_invalid")
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) fail("control_invalid")

  const job = await prisma.importQueueJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
      entityType: "products",
      syncMode: "full",
      OR: [
        { status: "PENDING" },
        { status: "FAILED", error: "full_sync_cancelled_cleanup_required" },
      ],
    },
  })
  if (!job) fail("job_not_waiting")

  if (job.status === "FAILED") {
    const cancellation = await prisma.auditLog.findFirst({
      where: {
        organizationId: job.organizationId,
        action: "catalog.full_sync_cancelled",
        entityType: "importBatch",
        entityId: job.batchId,
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    })
    const payload = cancellation?.payload
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("cancellation_context_mismatch")
    const context = payload as Record<string, unknown>
    if (
      context.changeId !== input.changeId ||
      context.requesterApprovalId !== input.requesterApprovalId ||
      context.reviewerApprovalId !== input.reviewerApprovalId ||
      context.reasonCode !== input.reasonCode
    ) fail("cancellation_context_mismatch")
  }

  if (job.status === "PENDING") {
    const cancelled = await prisma.$transaction(async (tx) => {
      const claimed = await tx.importQueueJob.updateMany({
        where: {
          id: job.id,
          organizationId: job.organizationId,
          entityType: "products",
          syncMode: "full",
          status: "PENDING",
        },
        data: { status: "FAILED", error: "full_sync_cancelled_cleanup_required", finishedAt: now },
      })
      if (claimed.count !== 1) return false
      await tx.importBatch.update({
        where: { id: job.batchId },
        data: { status: "FAILED", finishedAt: now },
      })
      await tx.auditLog.create({
        data: {
          organizationId: job.organizationId,
          userId: job.createdById,
          action: "catalog.full_sync_cancelled",
          entityType: "importBatch",
          entityId: job.batchId,
          payload: {
            changeId: input.changeId,
            requesterApprovalId: input.requesterApprovalId,
            reviewerApprovalId: input.reviewerApprovalId,
            reasonCode: input.reasonCode,
            approvalWasAttached: job.fullSyncApprovalPath !== null,
          },
        },
      })
      return true
    })
    if (!cancelled) fail("job_not_waiting")
  }

  try {
    const queueRoot = await realpath(importQueueDir())
    await unlinkProtectedFullSyncFile(job.storagePath, Number(uid), { allowedParent: queueRoot })
    if (job.fullSyncApprovalPath) await unlinkProtectedFullSyncFile(job.fullSyncApprovalPath, Number(uid))
  } catch {
    fail("cleanup_failed")
  }

  await prisma.$transaction(async (tx) => {
    const completed = await tx.importQueueJob.updateMany({
      where: {
        id: job.id,
        organizationId: job.organizationId,
        status: "FAILED",
        error: "full_sync_cancelled_cleanup_required",
      },
      data: { error: "full_sync_cancelled", fullSyncApprovalPath: null, fullSyncApprovedAt: null },
    })
    if (completed.count === 1) {
      await tx.auditLog.create({
        data: {
          organizationId: job.organizationId,
          userId: job.createdById,
          action: "catalog.full_sync_cleanup_completed",
          entityType: "importBatch",
          entityId: job.batchId,
          payload: { changeId: input.changeId },
        },
      })
    }
  })
  return { cleanup: "completed" }
}
