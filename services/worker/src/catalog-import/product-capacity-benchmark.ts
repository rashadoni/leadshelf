import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import type { RawCsvRow } from "@leadshelf/core"
import { executeProductsImport } from "./execute-products-import"
import { enqueueCatalogImport, processNextCatalogImportJob } from "./queue"
import type { ImportReconciliation } from "./reconciliation"

const CONFIRMATION = "yes-i-understand-local-only"
const MAX_ROWS = 100_000
const SKU_PREFIX = "CAP-PRODUCT-"

type BenchmarkMode = "executor" | "queue"

type BenchmarkResult = {
  status: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED"
  reconciliation: ImportReconciliation
}

function configuration() {
  if (process.env.RUN_IMPORT_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_IMPORT_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("capacity benchmark refuses a non-loopback database")
  }
  const rows = Number(process.env.IMPORT_BENCHMARK_ROWS ?? 1_000)
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new Error(`IMPORT_BENCHMARK_ROWS must be an integer between 1 and ${MAX_ROWS}`)
  }
  const mode = process.env.IMPORT_BENCHMARK_MODE ?? "executor"
  if (mode !== "executor" && mode !== "queue") {
    throw new Error("IMPORT_BENCHMARK_MODE must be executor or queue")
  }
  return { rows, mode: mode as BenchmarkMode }
}

async function main() {
  const { rows: rowCount, mode } = configuration()
  const prisma = createSystemClient("local-product-capacity-benchmark")
  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: process.env.IMPORT_BENCHMARK_ORG_SLUG ?? "demo" },
      select: { id: true },
    })
    const rows: RawCsvRow[] = Array.from({ length: rowCount }, (_, index) => ({
      sku: `${SKU_PREFIX}${index.toString().padStart(6, "0")}`,
      name: `Capacity product ${index}`,
      barcode: `8${index.toString().padStart(12, "0")}`,
      unit: "PCS",
      widthMm: String(40 + (index % 20)),
      heightMm: String(80 + (index % 40)),
      depthMm: String(20 + (index % 10)),
      weightG: String(50 + (index % 200)),
      isActive: "true",
    }))
    const csvBuffer = mode === "queue"
      ? Buffer.from([
          "sku,name,barcode,unit,widthMm,heightMm,depthMm,weightG,isActive",
          ...rows.map((row) =>
            [
              row.sku,
              row.name,
              row.barcode,
              row.unit,
              row.widthMm,
              row.heightMm,
              row.depthMm,
              row.weightG,
              row.isActive,
            ].join(","),
          ),
        ].join("\n"))
      : null

    const runImport = async (
      source: string,
      expectedChecksum?: string,
    ): Promise<BenchmarkResult> => {
      if (mode === "executor") {
        return executeProductsImport(prisma, {
          organizationId: organization.id,
          rows,
          source,
          expectedRows: rowCount,
          expectedChecksum,
        })
      }
      const queued = await enqueueCatalogImport(prisma, {
        organizationId: organization.id,
        entityType: "products",
        buffer: csvBuffer!,
        fileName: `${source}.csv`,
        source: "csv",
        encoding: "utf-8",
        delimiter: ",",
      })
      const processed = await processNextCatalogImportJob(prisma)
      if (!processed || processed.jobId !== queued.jobId || processed.batchId !== queued.batchId) {
        throw new Error("queued product benchmark job was not processed")
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
    const beforeRows = await prisma.product.count({
      where: { organizationId: organization.id, sku: { startsWith: SKU_PREFIX } },
    })
    if (beforeRows !== 0) throw new Error(`benchmark SKU range is not empty: ${beforeRows}`)

    const rssBefore = process.memoryUsage().rss
    const firstStarted = performance.now()
    const first = await runImport("product-capacity-benchmark")
    const firstDurationMs = performance.now() - firstStarted
    const afterFirstRows = await prisma.product.count({
      where: { organizationId: organization.id, sku: { startsWith: SKU_PREFIX } },
    })

    const replayStarted = performance.now()
    const replay = await runImport(
      "product-capacity-benchmark-replay",
      first.reconciliation.sourceChecksum,
    )
    const replayDurationMs = performance.now() - replayStarted
    const afterReplayRows = await prisma.product.count({
      where: { organizationId: organization.id, sku: { startsWith: SKU_PREFIX } },
    })
    const barcodeRows = await prisma.productBarcode.count({
      where: { organizationId: organization.id, product: { sku: { startsWith: SKU_PREFIX } } },
    })
    const rssAfter = process.memoryUsage().rss

    if (
      first.status !== "COMPLETED" ||
      replay.status !== "COMPLETED" ||
      first.reconciliation.status !== "MATCH" ||
      replay.reconciliation.status !== "MATCH" ||
      afterFirstRows !== rowCount ||
      afterReplayRows !== rowCount ||
      barcodeRows !== rowCount
    ) {
      throw new Error("product capacity benchmark integrity assertion failed")
    }

    console.log(JSON.stringify({
      rows: rowCount,
      mode,
      inputBytes: csvBuffer?.byteLength ?? null,
      first: {
        durationMs: Math.round(firstDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / firstDurationMs),
      },
      replay: {
        durationMs: Math.round(replayDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / replayDurationMs),
      },
      reconciliation: [first.reconciliation.status, replay.reconciliation.status],
      integrity: { beforeRows, afterFirstRows, afterReplayRows, barcodeRows },
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
