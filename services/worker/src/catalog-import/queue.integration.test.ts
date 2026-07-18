import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createSystemClient } from "@leadshelf/db"
import { enqueueCatalogImport, processNextCatalogImportJob, recoverStaleCatalogImportJobs } from "./queue"
import type { ImportQueueRetryPolicy } from "./retry-policy"

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
})
