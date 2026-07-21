import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { access, chmod, mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createSystemClient } from "@leadshelf/db"
import { enqueueCatalogImport, processNextCatalogImportJob, recoverStaleCatalogImportJobs } from "./queue"
import type { ImportQueueRetryPolicy } from "./retry-policy"
import { checksumImportRows, signDestructiveFullSyncApproval } from "./reconciliation"
import { readCsvRecords } from "./csv"
import {
  attachFullSyncApprovalToJob,
  checksumActiveProductSkus,
  prepareFullSyncApprovalRequest,
} from "./full-sync-workflow"
import { issueDestructiveFullSyncApprovalFromFiles } from "./full-sync-approval"
import { cancelPendingFullSyncJob } from "./full-sync-cancel"

const prisma = createSystemClient("import-queue-recovery-test")
const policy: ImportQueueRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  staleAfterMs: 60_000,
}
let organizationId: string
let queuePath: string

beforeAll(async () => {
  queuePath = await mkdtemp(path.join(os.tmpdir(), "leadshelf-import-queue-"))
  process.env.LEADSHELF_IMPORT_QUEUE_DIR = queuePath
  const organization = await prisma.organization.create({
    data: { name: "Import queue recovery test", slug: `import-queue-recovery-${Date.now()}` },
  })
  organizationId = organization.id
})

afterAll(async () => {
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
  await prisma.$disconnect()
  await rm(queuePath, { recursive: true, force: true })
  delete process.env.LEADSHELF_IMPORT_QUEUE_DIR
})

describe("durable catalog import queue recovery", () => {
  it("backs off after a transient file error and completes the same job without duplicate products", async () => {
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "retry.csv",
      buffer: Buffer.from("sku,name\nRECOVERY-1,Recovered product\n"),
    })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    await unlink(job.storagePath)
    const firstAttemptAt = new Date(job.availableAt.getTime() + 1)

    expect(await processNextCatalogImportJob(prisma, { now: firstAttemptAt, policy })).toBeNull()
    const delayed = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    expect(delayed).toMatchObject({ status: "PENDING", attempts: 1 })
    expect(delayed.availableAt).toEqual(new Date(firstAttemptAt.getTime() + 100))
    expect(await processNextCatalogImportJob(prisma, {
      now: new Date(firstAttemptAt.getTime() + 99), policy,
    })).toBeNull()

    await writeFile(job.storagePath, "sku,name\nRECOVERY-1,Recovered product\n")
    const completed = await processNextCatalogImportJob(prisma, {
      now: new Date(firstAttemptAt.getTime() + 100), policy,
    })
    expect(completed).toMatchObject({ jobId: queued.jobId, status: "COMPLETED" })
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "COMPLETED", attempts: 2, error: null,
    })
    expect(await prisma.product.count({ where: { organizationId, sku: "RECOVERY-1" } })).toBe(1)
  })

  it("requeues an expired lease and terminally fails it after the attempt limit", async () => {
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "stale.csv",
      buffer: Buffer.from("sku,name\nSTALE-1,Stale product\n"),
    })
    const now = new Date("2026-07-18T19:00:00.000Z")
    const staleStartedAt = new Date(now.getTime() - policy.staleAfterMs - 1)
    await prisma.importQueueJob.update({
      where: { id: queued.jobId },
      data: { status: "PROCESSING", attempts: 1, startedAt: staleStartedAt },
    })
    await prisma.importBatch.update({ where: { id: queued.batchId }, data: { status: "PROCESSING" } })

    expect(await recoverStaleCatalogImportJobs(prisma, { now, policy })).toEqual({ retried: 1, failed: 0 })
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "PENDING", attempts: 1, error: "worker_lease_expired",
    })

    await prisma.importQueueJob.update({
      where: { id: queued.jobId },
      data: { status: "PROCESSING", attempts: policy.maxAttempts, startedAt: staleStartedAt },
    })
    await prisma.importBatch.update({ where: { id: queued.batchId }, data: { status: "PROCESSING" } })
    expect(await recoverStaleCatalogImportJobs(prisma, { now, policy })).toEqual({ retried: 0, failed: 1 })
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "FAILED", attempts: policy.maxAttempts, error: "worker_lease_expired_max_attempts",
    })
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: queued.batchId } })).toMatchObject({ status: "FAILED" })
  })

  it("allows only one worker to claim the same pending import", async () => {
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "concurrent.csv",
      buffer: Buffer.from("sku,name\nCONCURRENT-1,Concurrent product\n"),
    })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    const now = new Date(job.availableAt.getTime() + 1)
    const results = await Promise.all([
      processNextCatalogImportJob(prisma, { now, policy }),
      processNextCatalogImportJob(prisma, { now, policy }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "COMPLETED",
      attempts: 1,
    })
    expect(await prisma.product.count({ where: { organizationId, sku: "CONCURRENT-1" } })).toBe(1)
  })

  it("persists the ERP manifest and propagates a mismatch through the durable queue", async () => {
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "manifest.csv",
      buffer: Buffer.from("sku,name\nMANIFEST-1,Manifest product\n"),
      expectedRows: 2,
      expectedChecksum: "0".repeat(64),
    })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    expect(job).toMatchObject({ expectedRows: 2, expectedChecksum: "0".repeat(64) })

    expect(await processNextCatalogImportJob(prisma, {
      now: new Date(job.availableAt.getTime() + 1), policy,
    })).toMatchObject({ status: "COMPLETED_WITH_ERRORS" })
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: queued.batchId } })
    expect(batch).toMatchObject({ status: "COMPLETED_WITH_ERRORS" })
    expect(batch.reconciliation).toMatchObject({
      status: "MISMATCH",
      mismatches: ["erp_row_count_mismatch", "erp_checksum_mismatch"],
    })
  })

  it("persists a full sync but never claims it without an attached approval", async () => {
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "full-sync.csv",
      buffer: Buffer.from("sku,name\nFULL-1,Full product\n"),
      expectedRows: 1,
      expectedChecksum: "f".repeat(64),
      syncMode: "full",
    })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    expect(job).toMatchObject({ syncMode: "full", fullSyncApprovalPath: null, attempts: 0, status: "PENDING" })

    process.env.LEADSHELF_FULL_SYNC_ENABLED = "true"
    try {
      expect(await processNextCatalogImportJob(prisma, {
        now: new Date(job.availableAt.getTime() + 1), policy,
      })).toBeNull()
    } finally {
      delete process.env.LEADSHELF_FULL_SYNC_ENABLED
    }
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      attempts: 0,
      status: "PENDING",
    })
    expect(await prisma.product.count({ where: { organizationId, sku: "FULL-1" } })).toBe(0)
  })

  it("atomically cancels a pending full sync and safely retries artifact cleanup", async () => {
    const suffix = `cancel-${Date.now().toString(36)}`
    const rows = readCsvRecords(Buffer.from(`sku,name\nFULL-${suffix},Cancelled product\n`))
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "full-sync-cancel.csv",
      buffer: Buffer.from(`sku,name\nFULL-${suffix},Cancelled product\n`),
      expectedRows: rows.length,
      expectedChecksum: checksumImportRows(rows),
      syncMode: "full",
    })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    const tokenFile = path.join(queuePath, `cancel-token-${suffix}`)
    await writeFile(tokenFile, "protected-cancel-token\n", { mode: 0o600 })
    await prisma.importQueueJob.update({
      where: { id: queued.jobId },
      data: { fullSyncApprovalPath: tokenFile, fullSyncApprovedAt: new Date() },
    })
    const control = {
      organizationId,
      jobId: queued.jobId,
      changeId: `CHG-${suffix}`,
      requesterApprovalId: `requester-${suffix}`,
      reviewerApprovalId: `reviewer-${suffix}`,
      reasonCode: "operator-cancelled-stale-source",
      confirmation: `CANCEL FULL SYNC ${queued.jobId} ${organizationId}`,
    }

    await chmod(job.storagePath, 0o644)
    await expect(cancelPendingFullSyncJob(prisma, control)).rejects.toMatchObject({ code: "cleanup_failed" })
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "FAILED",
      error: "full_sync_cancelled_cleanup_required",
    })
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: queued.batchId } })).toMatchObject({ status: "FAILED" })
    expect(await prisma.auditLog.count({
      where: { organizationId, action: "catalog.full_sync_cancelled", entityId: queued.batchId },
    })).toBe(1)

    await chmod(job.storagePath, 0o600)
    await expect(cancelPendingFullSyncJob(prisma, {
      ...control,
      changeId: `CHG-different-${suffix}`,
    })).rejects.toMatchObject({ code: "cancellation_context_mismatch" })
    await expect(cancelPendingFullSyncJob(prisma, control)).resolves.toEqual({ cleanup: "completed" })
    await expect(access(job.storagePath)).rejects.toThrow()
    await expect(access(tokenFile)).rejects.toThrow()
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "FAILED",
      error: "full_sync_cancelled",
      fullSyncApprovalPath: null,
      fullSyncApprovedAt: null,
    })
    expect(await prisma.auditLog.count({
      where: { organizationId, action: "catalog.full_sync_cancelled", entityId: queued.batchId },
    })).toBe(1)
    expect(await prisma.auditLog.count({
      where: { organizationId, action: "catalog.full_sync_cleanup_completed", entityId: queued.batchId },
    })).toBe(1)
    expect(await prisma.product.count({ where: { organizationId, sku: `FULL-${suffix}` } })).toBe(0)
  })

  it("rejects full sync for unsupported entities or without an exact manifest", async () => {
    await expect(enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "stock",
      source: "csv",
      fileName: "stock.csv",
      buffer: Buffer.from("sku,quantity\nFULL-1,1\n"),
      expectedRows: 1,
      expectedChecksum: "f".repeat(64),
      syncMode: "full",
    })).rejects.toThrow("full_sync_entity_not_supported")
    await expect(enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "products.csv",
      buffer: Buffer.from("sku,name\nFULL-1,Full product\n"),
      syncMode: "full",
    })).rejects.toThrow("full_sync_manifest_required")
  })

  it("atomically applies an approved full sync, audits it and preserves another tenant", async () => {
    const suffix = Date.now().toString(36)
    const neighbor = await prisma.organization.create({
      data: { name: "Full sync neighbor", slug: `full-sync-neighbor-${suffix}` },
    })
    const existing = await prisma.product.createMany({
      data: [
        { organizationId, sku: `FULL-KEEP-${suffix}`, name: "Keep" },
        { organizationId, sku: `FULL-ABSENT-${suffix}`, name: "Absent" },
        { organizationId: neighbor.id, sku: `FULL-ABSENT-${suffix}`, name: "Neighbor" },
      ],
    })
    expect(existing.count).toBe(3)
    const csv = Buffer.from(
      `sku,name,isActive\nFULL-KEEP-${suffix},Keep updated,true\nFULL-NEW-${suffix},New,true\n`,
    )
    const rows = readCsvRecords(csv)
    const sourceChecksum = checksumImportRows(rows)
    const currentActiveProducts = await prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { sku: true },
    })
    const currentActiveRows = currentActiveProducts.length
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "approved-full-sync.csv",
      buffer: csv,
      expectedRows: rows.length,
      expectedChecksum: sourceChecksum,
      syncMode: "full",
    })
    const now = new Date()
    const secret = "Q".repeat(48)
    const secretFile = path.join(queuePath, `secret-${suffix}`)
    const controlFile = path.join(queuePath, `control-${suffix}.json`)
    const requestFile = path.join(queuePath, `request-${suffix}.json`)
    const tokenFile = path.join(queuePath, `token-${suffix}`)
    await writeFile(secretFile, `${secret}\n`, { mode: 0o600 })
    await writeFile(controlFile, `${JSON.stringify({
      organizationId,
      jobId: queued.jobId,
      changeId: `CHG-${suffix}`,
      requesterApprovalId: `requester-${suffix}`,
      reviewerApprovalId: `reviewer-${suffix}`,
      reasonCode: "authoritative-catalog-reconciliation",
      ttlSeconds: 1800,
    })}\n`, { mode: 0o600 })
    await expect(prepareFullSyncApprovalRequest(prisma, {
      controlFile,
      outputFile: requestFile,
      now,
    })).resolves.toEqual({ changeId: `CHG-${suffix}` })
    await expect(issueDestructiveFullSyncApprovalFromFiles({
      requestFile,
      secretFile,
      outputFile: tokenFile,
      now,
    })).resolves.toEqual({ changeId: `CHG-${suffix}` })
    await expect(attachFullSyncApprovalToJob(prisma, {
      organizationId,
      jobId: queued.jobId,
      tokenFile,
      secretFile,
      now,
    })).resolves.toEqual({ changeId: `CHG-${suffix}` })

    process.env.LEADSHELF_FULL_SYNC_ENABLED = "true"
    process.env.LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE = secretFile
    try {
      await expect(processNextCatalogImportJob(prisma, {
        now: new Date(now.getTime() + 1_000), policy,
      })).resolves.toMatchObject({ jobId: queued.jobId, status: "COMPLETED" })
    } finally {
      delete process.env.LEADSHELF_FULL_SYNC_ENABLED
      delete process.env.LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE
    }
    expect(await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId, sku: `FULL-KEEP-${suffix}` } },
    })).toMatchObject({ name: "Keep updated", isActive: true })
    expect(await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId, sku: `FULL-NEW-${suffix}` } },
    })).toMatchObject({ isActive: true })
    expect(await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId, sku: `FULL-ABSENT-${suffix}` } },
    })).toMatchObject({ isActive: false })
    expect(await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId: neighbor.id, sku: `FULL-ABSENT-${suffix}` } },
    })).toMatchObject({ isActive: true })
    expect(await prisma.auditLog.findFirstOrThrow({
      where: { organizationId, action: "catalog.full_sync_applied", entityId: queued.batchId },
    })).toMatchObject({
      payload: expect.objectContaining({
        changeId: `CHG-${suffix}`,
        sourceChecksum,
        currentActiveRows,
        incomingActiveRows: 2,
      }),
    })
    const completedJob = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    await expect(access(completedJob.storagePath)).rejects.toThrow()
    await expect(access(tokenFile)).rejects.toThrow()
    await expect(access(secretFile)).resolves.toBeUndefined()
    await prisma.organization.delete({ where: { id: neighbor.id } })
  })

  it("rolls back every product change when an attached source drifts", async () => {
    const suffix = `drift-${Date.now().toString(36)}`
    await prisma.product.create({ data: { organizationId, sku: `FULL-${suffix}`, name: "Original" } })
    const csv = Buffer.from(`sku,name\nFULL-${suffix},Updated\n`)
    const rows = readCsvRecords(csv)
    const sourceChecksum = checksumImportRows(rows)
    const currentActiveProducts = await prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { sku: true },
    })
    const currentActiveRows = currentActiveProducts.length
    const queued = await enqueueCatalogImport(prisma, {
      organizationId,
      entityType: "products",
      source: "csv",
      fileName: "drift-full-sync.csv",
      buffer: csv,
      expectedRows: 1,
      expectedChecksum: sourceChecksum,
      syncMode: "full",
    })
    const now = new Date()
    const secret = "R".repeat(48)
    const tokenFile = path.join(queuePath, `token-${suffix}`)
    const secretFile = path.join(queuePath, `secret-${suffix}`)
    await writeFile(tokenFile, `${signDestructiveFullSyncApproval({
      version: 1,
      action: "deactivate_absent_products",
      changeId: `CHG-${suffix}`,
      requesterApprovalId: `requester-${suffix}`,
      reviewerApprovalId: `reviewer-${suffix}`,
      reasonCode: "authoritative-catalog-reconciliation",
      organizationId,
      entityType: "products",
      sourceChecksum,
      currentActiveChecksum: checksumActiveProductSkus(currentActiveProducts.map((product) => product.sku)),
      currentActiveRows,
      incomingActiveRows: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    }, secret)}\n`, { mode: 0o600 })
    await writeFile(secretFile, `${secret}\n`, { mode: 0o600 })
    await attachFullSyncApprovalToJob(prisma, { organizationId, jobId: queued.jobId, tokenFile, secretFile, now })
    const job = await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    await writeFile(job.storagePath, `sku,name\nFULL-${suffix},Tampered\n`, { mode: 0o600 })

    process.env.LEADSHELF_FULL_SYNC_ENABLED = "true"
    process.env.LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE = secretFile
    try {
      await expect(processNextCatalogImportJob(prisma, {
        now: new Date(now.getTime() + 1_000), policy,
      })).resolves.toMatchObject({ jobId: queued.jobId, status: "FAILED" })
    } finally {
      delete process.env.LEADSHELF_FULL_SYNC_ENABLED
      delete process.env.LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE
    }
    expect(await prisma.product.findUniqueOrThrow({
      where: { organizationId_sku: { organizationId, sku: `FULL-${suffix}` } },
    })).toMatchObject({ name: "Original", isActive: true })
    expect(await prisma.auditLog.count({
      where: { organizationId, action: "catalog.full_sync_applied", entityId: queued.batchId },
    })).toBe(0)
    expect(await prisma.importQueueJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      error: "manifest_mismatch",
      fullSyncApprovalPath: null,
      fullSyncApprovedAt: null,
    })
    await expect(access(tokenFile)).rejects.toThrow()
  })

  it("DB trigger blocks a concurrent same-tenant product write without blocking a neighbor tenant", async () => {
    const suffix = `lock-${Date.now().toString(36)}`
    const neighbor = await prisma.organization.create({
      data: { name: "Product lock neighbor", slug: `product-lock-neighbor-${suffix}` },
    })
    const target = await prisma.product.create({
      data: { organizationId, sku: `LOCK-${suffix}`, name: "Original" },
    })
    const neighborProduct = await prisma.product.create({
      data: { organizationId: neighbor.id, sku: `LOCK-${suffix}`, name: "Neighbor original" },
    })
    const writer = createSystemClient("product-tenant-lock-writer-test")
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 5))`
        await expect(writer.product.update({
          where: { id: neighborProduct.id },
          data: { name: "Neighbor updated" },
        })).resolves.toMatchObject({ name: "Neighbor updated" })
        await expect(writer.$transaction(async (writerTx) => {
          await writerTx.$executeRawUnsafe("SET LOCAL statement_timeout = '150ms'")
          return writerTx.product.update({ where: { id: target.id }, data: { name: "Must wait" } })
        })).rejects.toThrow()
      })
      expect(await prisma.product.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ name: "Original" })
      await expect(writer.product.update({
        where: { id: target.id },
        data: { name: "After release" },
      })).resolves.toMatchObject({ name: "After release" })
    } finally {
      await writer.$disconnect()
      await prisma.organization.delete({ where: { id: neighbor.id } })
    }
  })
})
