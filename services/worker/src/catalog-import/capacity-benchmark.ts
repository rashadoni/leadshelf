import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import type { RawCsvRow } from "@leadshelf/core"
import { enqueueCatalogImport, processNextCatalogImportJob } from "./queue"
import { executeSnapshotsImport, type SnapshotsImportInput } from "./execute-snapshots-import"
import type { ImportReconciliation } from "./reconciliation"

const CONFIRMATION = "yes-i-understand-local-only"
const DEFAULT_ROWS = 100_000
const MAX_ROWS = 500_000

type BenchmarkMode = "executor" | "queue"

type BenchmarkResult = {
  status: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED"
  reconciliation: ImportReconciliation
}

function benchmarkRows(): number {
  const value = Number(process.env.IMPORT_BENCHMARK_ROWS ?? DEFAULT_ROWS)
  if (!Number.isInteger(value) || value < 1 || value > MAX_ROWS) {
    throw new Error(`IMPORT_BENCHMARK_ROWS must be an integer between 1 and ${MAX_ROWS}`)
  }
  return value
}

function benchmarkMode(): BenchmarkMode {
  const value = process.env.IMPORT_BENCHMARK_MODE ?? "executor"
  if (value !== "executor" && value !== "queue") {
    throw new Error("IMPORT_BENCHMARK_MODE must be executor or queue")
  }
  return value
}

function assertLocalDatabase(): void {
  if (process.env.RUN_IMPORT_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_IMPORT_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("capacity benchmark refuses a non-loopback database")
  }
}

function isoDate(baseMs: number, dayOffset: number): string {
  return new Date(baseMs + dayOffset * 86_400_000).toISOString().slice(0, 10)
}

async function main() {
  assertLocalDatabase()
  const rowCount = benchmarkRows()
  const mode = benchmarkMode()
  const prisma = createSystemClient("local-import-capacity-benchmark")

  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: process.env.IMPORT_BENCHMARK_ORG_SLUG ?? "demo" },
      select: { id: true },
    })
    const [products, stores] = await Promise.all([
      prisma.product.findMany({
        where: { organizationId: organization.id, isActive: true },
        orderBy: { sku: "asc" },
        select: { sku: true },
      }),
      prisma.store.findMany({
        where: { organizationId: organization.id, code: { not: null }, isActive: true },
        orderBy: { code: "asc" },
        select: { code: true },
      }),
    ])
    if (products.length === 0 || stores.length === 0) {
      throw new Error("benchmark requires at least one active product and coded store")
    }

    const combinations = products.length * stores.length
    const baseMs = Date.UTC(2040, 0, 1)
    const dates = Array.from({ length: Math.ceil(rowCount / combinations) }, (_, day) =>
      isoDate(baseMs, day),
    )
    const rows: RawCsvRow[] = Array.from({ length: rowCount }, (_, index) => {
      const product = products[index % products.length]!
      const store = stores[Math.floor(index / products.length) % stores.length]!
      const day = Math.floor(index / combinations)
      return {
        sku: product.sku,
        storeCode: store.code!,
        date: dates[day]!,
        quantity: String((index % 17) + 1),
        revenue: String((index % 10_000) + 100),
        profit: String((index % 2_000) - 500),
      }
    })
    const csvBuffer = mode === "queue"
      ? Buffer.from([
          "sku,storeCode,date,quantity,revenue,profit",
          ...rows.map((row) =>
            [row.sku, row.storeCode, row.date, row.quantity, row.revenue, row.profit].join(","),
          ),
        ].join("\n"))
      : null

    const runImport = async (
      source: string,
      expectedChecksum?: string,
    ): Promise<BenchmarkResult> => {
      if (mode === "executor") {
        return executeSnapshotsImport(prisma, {
          organizationId: organization.id,
          entityType: "sales",
          rows,
          source,
          expectedRows: rowCount,
          expectedChecksum,
        } satisfies SnapshotsImportInput)
      }
      const queued = await enqueueCatalogImport(prisma, {
        organizationId: organization.id,
        entityType: "sales",
        buffer: csvBuffer!,
        fileName: `${source}.csv`,
        source: "csv",
        encoding: "utf-8",
        delimiter: ",",
      })
      const processed = await processNextCatalogImportJob(prisma)
      if (!processed || processed.jobId !== queued.jobId || processed.batchId !== queued.batchId) {
        throw new Error("queued benchmark job was not processed")
      }
      const batch = await prisma.importBatch.findUniqueOrThrow({
        where: { id: queued.batchId },
        select: { status: true, reconciliation: true },
      })
      return {
        status: batch.status as BenchmarkResult["status"],
        reconciliation: batch.reconciliation as ImportReconciliation,
      }
    }

    const dateFrom = new Date(`${dates[0]}T00:00:00.000Z`)
    const dateTo = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`)
    const beforeRows = await prisma.salesSnapshot.count({
      where: { organizationId: organization.id, date: { gte: dateFrom, lte: dateTo } },
    })
    if (beforeRows !== 0) {
      throw new Error(`benchmark date range is not empty: ${beforeRows} existing rows`)
    }

    const rssBefore = process.memoryUsage().rss
    const firstStarted = performance.now()
    const first = await runImport("capacity-benchmark")
    const firstDurationMs = performance.now() - firstStarted
    const afterFirstRows = await prisma.salesSnapshot.count({
      where: { organizationId: organization.id, date: { gte: dateFrom, lte: dateTo } },
    })

    const replayStarted = performance.now()
    const replay = await runImport(
      "capacity-benchmark-replay",
      first.reconciliation.sourceChecksum,
    )
    const replayDurationMs = performance.now() - replayStarted
    const afterReplayRows = await prisma.salesSnapshot.count({
      where: { organizationId: organization.id, date: { gte: dateFrom, lte: dateTo } },
    })
    const rssAfter = process.memoryUsage().rss

    if (
      first.status !== "COMPLETED" ||
      replay.status !== "COMPLETED" ||
      first.reconciliation.status !== "MATCH" ||
      replay.reconciliation.status !== "MATCH" ||
      afterFirstRows !== rowCount ||
      afterReplayRows !== rowCount
    ) {
      throw new Error("capacity benchmark integrity assertion failed")
    }

    console.log(JSON.stringify({
      rows: rowCount,
      mode,
      inputBytes: csvBuffer?.byteLength ?? null,
      products: products.length,
      stores: stores.length,
      first: {
        durationMs: Math.round(firstDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / firstDurationMs),
        reconciliation: first.reconciliation.status,
      },
      replay: {
        durationMs: Math.round(replayDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / replayDurationMs),
        reconciliation: replay.reconciliation.status,
      },
      integrity: { beforeRows, afterFirstRows, afterReplayRows },
      rss: { beforeBytes: rssBefore, afterBytes: rssAfter, deltaBytes: rssAfter - rssBefore },
    }))
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
