import type { PrismaClient } from "@prisma/client"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { executeAssortmentImport } from "./execute-assortment-import"
import { executeProductsImport } from "./execute-products-import"
import { executeFullSyncProductsImport } from "./execute-full-sync-import"
import { executeSnapshotsImport } from "./execute-snapshots-import"
import { readCsvRecords } from "./csv"
import { readXlsxRecords } from "./xlsx"
import { importQueueRetryPolicy, retryDelayMs, type ImportQueueRetryPolicy } from "./retry-policy"
import { FullSyncWorkflowError, readCatalogImportJobRows } from "./full-sync-workflow"
import { FullSyncApprovalIssueError } from "./full-sync-approval"

type ImportEntityType = "products" | "prices" | "stock" | "sales" | "assortment"

export interface EnqueueCatalogImportInput {
  organizationId: string
  entityType: ImportEntityType
  buffer: Buffer
  fileName: string
  source: "csv" | "xlsx"
  encoding?: "utf-8" | "windows-1251"
  delimiter?: "," | ";"
  createdById?: string
  expectedRows?: number
  expectedChecksum?: string
  expectedTotals?: Record<string, string>
  syncMode?: "delta" | "full"
}

function queueDir(): string {
  return path.resolve(process.env.LEADSHELF_IMPORT_QUEUE_DIR ?? path.join(process.cwd(), ".data", "import-queue"))
}

export async function enqueueCatalogImport(
  prisma: PrismaClient,
  input: EnqueueCatalogImportInput,
): Promise<{ batchId: string; jobId: string; status: "PENDING" }> {
  const syncMode = input.syncMode ?? "delta"
  if (syncMode === "full" && input.entityType !== "products") {
    throw new Error("full_sync_entity_not_supported")
  }
  if (syncMode === "full" && (input.expectedRows == null || input.expectedChecksum == null)) {
    throw new Error("full_sync_manifest_required")
  }
  await mkdir(queueDir(), { recursive: true })
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "import.dat"
  const storagePath = path.join(queueDir(), `${Date.now()}-${randomUUID()}-${safeName}`)
  await writeFile(storagePath, input.buffer, { mode: 0o600 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          organizationId: input.organizationId,
          source: input.source,
          entityType: input.entityType,
          status: "PENDING",
          createdById: input.createdById ?? null,
        },
      })
      const job = await tx.importQueueJob.create({
        data: {
          organizationId: input.organizationId,
          batchId: batch.id,
          entityType: input.entityType,
          source: input.source,
          fileName: input.fileName,
          storagePath,
          encoding: input.encoding ?? null,
          delimiter: input.delimiter ?? null,
          expectedRows: input.expectedRows ?? null,
          expectedChecksum: input.expectedChecksum ?? null,
          expectedTotals: input.expectedTotals,
          syncMode,
          createdById: input.createdById ?? null,
        },
      })
      return { batchId: batch.id, jobId: job.id, status: "PENDING" as const }
    })
    return result
  } catch (error) {
    await unlink(storagePath).catch(() => undefined)
    throw error
  }
}

export async function processNextCatalogImportJob(
  prisma: PrismaClient,
  options: { now?: Date; policy?: ImportQueueRetryPolicy } = {},
): Promise<{ jobId: string; batchId: string; status: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" } | null> {
  const now = options.now ?? new Date()
  const policy = options.policy ?? importQueueRetryPolicy()
  await recoverStaleCatalogImportJobs(prisma, { now, policy })

  const fullSyncEnabled = process.env.LEADSHELF_FULL_SYNC_ENABLED === "true"
  const approvalSecretFile = process.env.LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE ?? ""
  const fullSyncRunnable = fullSyncEnabled && path.isAbsolute(approvalSecretFile)

  const job = await prisma.importQueueJob.findFirst({
    where: {
      status: "PENDING",
      availableAt: { lte: now },
      attempts: { lt: policy.maxAttempts },
      OR: [
        { syncMode: "delta" },
        ...(fullSyncRunnable ? [{ syncMode: "full", fullSyncApprovalPath: { not: null } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  })
  if (!job) return null

  const claimed = await prisma.importQueueJob.updateMany({
    where: { id: job.id, status: "PENDING", availableAt: { lte: now }, attempts: { lt: policy.maxAttempts } },
    data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: now, finishedAt: null, error: null },
  })
  if (claimed.count === 0) return null

  // Queue rows are internal input, but still fail closed if a damaged/manual
  // row points at another tenant's batch. Never update the foreign batch.
  const ownedBatch = await prisma.importBatch.findFirst({
    where: {
      id: job.batchId,
      organizationId: job.organizationId,
      entityType: job.entityType,
      source: job.source,
    },
    select: { id: true },
  })
  if (!ownedBatch) {
    await prisma.importQueueJob.updateMany({
      where: { id: job.id, organizationId: job.organizationId, status: "PROCESSING" },
      data: {
        status: "FAILED",
        error: "tenant_boundary_violation",
        finishedAt: now,
      },
    })
    await unlink(job.storagePath).catch(() => undefined)
    return { jobId: job.id, batchId: job.batchId, status: "FAILED" }
  }

  try {
    await prisma.$transaction([
      prisma.importError.deleteMany({ where: { batchId: job.batchId } }),
      prisma.importBatch.update({
        where: { id: job.batchId },
        data: { status: "PENDING", totalRows: 0, errorRows: 0, reconciliation: undefined, startedAt: null, finishedAt: null },
      }),
    ])
    const buffer = job.syncMode === "full" ? null : await readFile(job.storagePath)
    const rows = job.syncMode === "full"
      ? await readCatalogImportJobRows(job)
      : job.source === "xlsx"
        ? await readXlsxRecords(buffer!)
        : readCsvRecords(buffer!, {
            encoding: job.encoding === "windows-1251" ? "windows-1251" : "utf-8",
            delimiter: job.delimiter === ";" ? ";" : job.delimiter === "," ? "," : undefined,
          })
    const common = {
      organizationId: job.organizationId,
      rows,
      source: job.source,
      createdById: job.createdById ?? undefined,
      batchId: job.batchId,
      expectedRows: job.expectedRows ?? undefined,
      expectedChecksum: job.expectedChecksum ?? undefined,
    }
    const summary =
      job.entityType === "products" && job.syncMode === "full"
        ? await executeFullSyncProductsImport(prisma, {
            ...common,
            job,
            approvalSecretFile,
            now,
          })
        : job.entityType === "products"
          ? await executeProductsImport(prisma, common)
        : job.entityType === "assortment"
          ? await executeAssortmentImport(prisma, common)
          : await executeSnapshotsImport(prisma, {
              ...common,
              entityType: job.entityType as "prices" | "stock" | "sales",
              expectedTotals: (job.expectedTotals as Record<string, string> | null) ?? undefined,
            })

    await prisma.importQueueJob.update({
      where: { id: job.id },
      data: { status: summary.status, finishedAt: new Date(), error: null },
    })
    await unlink(job.storagePath).catch(() => undefined)
    if (job.fullSyncApprovalPath) await unlink(job.fullSyncApprovalPath).catch(() => undefined)
    return { jobId: job.id, batchId: job.batchId, status: summary.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const attempts = job.attempts + 1
    const terminalFullSyncFailure = job.syncMode === "full" && (
      error instanceof FullSyncWorkflowError || error instanceof FullSyncApprovalIssueError
    )
    const willRetry = !terminalFullSyncFailure && attempts < policy.maxAttempts
    const availableAt = new Date(now.getTime() + retryDelayMs(attempts, policy))
    await prisma.$transaction([
      prisma.importBatch.update({
        where: { id: job.batchId },
        data: willRetry ? { status: "PENDING", finishedAt: null } : { status: "FAILED", finishedAt: new Date() },
      }),
      prisma.importQueueJob.update({
        where: { id: job.id },
        data: willRetry
          ? { status: "PENDING", error: message.slice(0, 2_000), availableAt, startedAt: null, finishedAt: null }
          : {
              status: "FAILED",
              error: message.slice(0, 2_000),
              finishedAt: new Date(),
              ...(job.syncMode === "full" ? { fullSyncApprovalPath: null, fullSyncApprovedAt: null } : {}),
            },
      }),
    ])
    if (!willRetry && job.fullSyncApprovalPath) await unlink(job.fullSyncApprovalPath).catch(() => undefined)
    return willRetry ? null : { jobId: job.id, batchId: job.batchId, status: "FAILED" }
  }
}

export async function recoverStaleCatalogImportJobs(
  prisma: PrismaClient,
  options: { now?: Date; policy?: ImportQueueRetryPolicy } = {},
): Promise<{ retried: number; failed: number }> {
  const now = options.now ?? new Date()
  const policy = options.policy ?? importQueueRetryPolicy()
  const staleBefore = new Date(now.getTime() - policy.staleAfterMs)
  const staleJobs = await prisma.importQueueJob.findMany({
    where: { status: "PROCESSING", startedAt: { lte: staleBefore } },
    select: { id: true, batchId: true, attempts: true },
    take: 100,
  })
  let retried = 0
  let failed = 0

  for (const stale of staleJobs) {
    const willRetry = stale.attempts < policy.maxAttempts
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.importQueueJob.updateMany({
        where: { id: stale.id, status: "PROCESSING", startedAt: { lte: staleBefore } },
        data: willRetry
          ? { status: "PENDING", availableAt: now, startedAt: null, finishedAt: null, error: "worker_lease_expired" }
          : { status: "FAILED", finishedAt: now, error: "worker_lease_expired_max_attempts" },
      })
      if (result.count > 0) {
        await tx.importBatch.update({
          where: { id: stale.batchId },
          data: willRetry ? { status: "PENDING", finishedAt: null } : { status: "FAILED", finishedAt: now },
        })
      }
      return result.count > 0
    })
    if (!claimed) continue
    if (willRetry) retried++
    else failed++
  }
  return { retried, failed }
}
