import "dotenv/config"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSystemClient } from "@leadshelf/db"
import { enqueueCatalogImport, processNextCatalogImportJob } from "./queue"

const CONFIRMATION = "yes-i-understand-local-only"

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`expected integer between ${min} and ${max}`)
  }
  return parsed
}

function configuration() {
  if (process.env.RUN_IMPORT_BACKLOG_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_IMPORT_BACKLOG_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("backlog benchmark refuses a non-loopback database")
  }
  return {
    jobs: boundedInteger(process.env.IMPORT_BACKLOG_JOBS, 100, 1, 1_000),
    workers: boundedInteger(process.env.IMPORT_BACKLOG_WORKERS, 4, 1, 16),
  }
}

async function main() {
  const { jobs, workers } = configuration()
  const prisma = createSystemClient("local-import-backlog-benchmark")
  const queuePath = await mkdtemp(path.join(os.tmpdir(), "leadshelf-backlog-"))
  const previousQueuePath = process.env.LEADSHELF_IMPORT_QUEUE_DIR
  process.env.LEADSHELF_IMPORT_QUEUE_DIR = queuePath
  const slug = `import-backlog-${Date.now()}`
  let organizationId: string | null = null

  try {
    const organization = await prisma.organization.create({ data: { name: "Import backlog benchmark", slug } })
    const benchmarkOrganizationId = organization.id
    organizationId = benchmarkOrganizationId
    const enqueueStarted = performance.now()
    for (let index = 0; index < jobs; index++) {
      const suffix = index.toString().padStart(5, "0")
      await enqueueCatalogImport(prisma, {
        organizationId: benchmarkOrganizationId,
        entityType: "products",
        source: "csv",
        fileName: `backlog-${suffix}.csv`,
        buffer: Buffer.from(`sku,name\nBACKLOG-${suffix},Backlog product ${suffix}\n`),
      })
    }
    const enqueueDurationMs = performance.now() - enqueueStarted
    const processStarted = performance.now()
    let claimedResults = 0

    await Promise.all(Array.from({ length: workers }, async () => {
      while (true) {
        const result = await processNextCatalogImportJob(prisma)
        if (result) {
          claimedResults += 1
          continue
        }
        const outstanding = await prisma.importQueueJob.count({
          where: { organizationId: benchmarkOrganizationId, status: { in: ["PENDING", "PROCESSING"] } },
        })
        if (outstanding === 0) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }))
    const processDurationMs = performance.now() - processStarted
    const [completed, failed, products, attemptsNotOne, inputFiles] = await Promise.all([
      prisma.importQueueJob.count({ where: { organizationId: benchmarkOrganizationId, status: "COMPLETED" } }),
      prisma.importQueueJob.count({ where: { organizationId: benchmarkOrganizationId, status: "FAILED" } }),
      prisma.product.count({ where: { organizationId: benchmarkOrganizationId, sku: { startsWith: "BACKLOG-" } } }),
      prisma.importQueueJob.count({ where: { organizationId: benchmarkOrganizationId, attempts: { not: 1 } } }),
      readdir(queuePath),
    ])
    if (completed !== jobs || failed !== 0 || products !== jobs || attemptsNotOne !== 0 || inputFiles.length !== 0) {
      throw new Error("backlog benchmark integrity assertion failed")
    }

    console.log(JSON.stringify({
      jobs,
      workers,
      enqueueDurationMs: Math.round(enqueueDurationMs),
      processDurationMs: Math.round(processDurationMs),
      jobsPerSecond: Math.round((jobs * 1_000) / processDurationMs),
      integrity: { completed, failed, products, attemptsNotOne, remainingInputFiles: inputFiles.length, claimedResults },
    }))
  } finally {
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
    await rm(queuePath, { recursive: true, force: true })
    if (previousQueuePath === undefined) delete process.env.LEADSHELF_IMPORT_QUEUE_DIR
    else process.env.LEADSHELF_IMPORT_QUEUE_DIR = previousQueuePath
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
