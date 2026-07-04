import type { PrismaClient } from "@prisma/client"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { executeAssortmentImport } from "./execute-assortment-import"
import { executeProductsImport } from "./execute-products-import"
import { executeSnapshotsImport } from "./execute-snapshots-import"
import { readCsvRecords } from "./csv"
import { readXlsxRecords } from "./xlsx"

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
}

function queueDir(): string {
  return process.env.LEADSHELF_IMPORT_QUEUE_DIR ?? path.join(process.cwd(), ".data", "import-queue")
}

export async function enqueueCatalogImport(
  prisma: PrismaClient,
  input: EnqueueCatalogImportInput,
): Promise<{ batchId: string; jobId: string; status: "PENDING" }> {
  await mkdir(queueDir(), { recursive: true })
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "import.dat"
  const storagePath = path.join(queueDir(), `${Date.now()}-${randomUUID()}-${safeName}`)
  await writeFile(storagePath, input.buffer)

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
): Promise<{ jobId: string; batchId: string; status: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" } | null> {
  const job = await prisma.importQueueJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  })
  if (!job) return null

  const claimed = await prisma.importQueueJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), error: null },
  })
  if (claimed.count === 0) return null

  try {
    const buffer = await readFile(job.storagePath)
    const rows =
      job.source === "xlsx"
        ? readXlsxRecords(buffer)
        : readCsvRecords(buffer, {
            encoding: job.encoding === "windows-1251" ? "windows-1251" : "utf-8",
            delimiter: job.delimiter === ";" ? ";" : job.delimiter === "," ? "," : undefined,
          })
    const common = {
      organizationId: job.organizationId,
      rows,
      source: job.source,
      createdById: job.createdById ?? undefined,
      batchId: job.batchId,
    }
    const summary =
      job.entityType === "products"
        ? await executeProductsImport(prisma, common)
        : job.entityType === "assortment"
          ? await executeAssortmentImport(prisma, common)
          : await executeSnapshotsImport(prisma, { ...common, entityType: job.entityType as "prices" | "stock" | "sales" })

    await prisma.importQueueJob.update({
      where: { id: job.id },
      data: { status: summary.status, finishedAt: new Date() },
    })
    await unlink(job.storagePath).catch(() => undefined)
    return { jobId: job.id, batchId: job.batchId, status: summary.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.$transaction([
      prisma.importBatch.update({
        where: { id: job.batchId },
        data: { status: "FAILED", finishedAt: new Date() },
      }),
      prisma.importQueueJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      }),
    ])
    return { jobId: job.id, batchId: job.batchId, status: "FAILED" }
  }
}
