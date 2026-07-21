import "dotenv/config"
import ExcelJS from "exceljs"
import { createSystemClient } from "@leadshelf/db"
import type { RawCsvRow } from "@leadshelf/core"
import { executeAssortmentImport } from "./execute-assortment-import"
import { enqueueCatalogImport, processNextCatalogImportJob } from "./queue"
import type { ImportReconciliation } from "./reconciliation"

const CONFIRMATION = "yes-i-understand-local-only"
const MAX_ROWS = 100_000
const SKU_PREFIX = "CAP-ASSORT-"
const STORE_COUNT = 100

type BenchmarkMode = "executor" | "csv" | "xlsx"
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
  if (mode !== "executor" && mode !== "csv" && mode !== "xlsx") {
    throw new Error("IMPORT_BENCHMARK_MODE must be executor, csv or xlsx")
  }
  return { rows, mode: mode as BenchmarkMode }
}

async function xlsxBuffer(rows: RawCsvRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Assortment")
  sheet.addRow(["sku", "scope", "format", "storecode", "isactive"])
  for (const row of rows) {
    sheet.addRow([row.sku, row.scope, row.format, row.storecode, row.isactive])
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function main() {
  const { rows: rowCount, mode } = configuration()
  const prisma = createSystemClient("local-assortment-capacity-benchmark")
  try {
    const organization = await prisma.organization.create({
      data: { name: "Assortment Capacity", slug: `assortment-capacity-${Date.now()}` },
    })
    const format = await prisma.storeFormat.create({
      data: { organizationId: organization.id, name: "Capacity format" },
    })
    await prisma.store.createMany({
      data: Array.from({ length: STORE_COUNT }, (_, index) => ({
        organizationId: organization.id,
        formatId: format.id,
        name: `Capacity store ${index + 1}`,
        code: `CAP-${index.toString().padStart(3, "0")}`,
      })),
    })
    for (let offset = 0; offset < rowCount; offset += 5_000) {
      await prisma.product.createMany({
        data: Array.from({ length: Math.min(5_000, rowCount - offset) }, (_, inner) => {
          const index = offset + inner
          return {
            organizationId: organization.id,
            sku: `${SKU_PREFIX}${index.toString().padStart(6, "0")}`,
            name: `Capacity assortment product ${index}`,
          }
        }),
      })
    }

    const rows: RawCsvRow[] = Array.from({ length: rowCount }, (_, index) => ({
      sku: `${SKU_PREFIX}${index.toString().padStart(6, "0")}`,
      scope: index % 2 === 0 ? "format" : "store",
      format: index % 2 === 0 ? "Capacity format" : "",
      storecode: index % 2 === 0 ? "" : `CAP-${(index % STORE_COUNT).toString().padStart(3, "0")}`,
      isactive: index % 7 === 0 ? "false" : "true",
    }))
    const inputBuffer = mode === "csv"
      ? Buffer.from([
          "sku,scope,format,storecode,isactive",
          ...rows.map((row) => [row.sku, row.scope, row.format, row.storecode, row.isactive].join(",")),
        ].join("\n"))
      : mode === "xlsx"
        ? await xlsxBuffer(rows)
        : null

    const runImport = async (source: string): Promise<BenchmarkResult> => {
      if (mode === "executor") {
        return executeAssortmentImport(prisma, {
          organizationId: organization.id,
          rows,
          source,
          expectedRows: rowCount,
        })
      }
      const queued = await enqueueCatalogImport(prisma, {
        organizationId: organization.id,
        entityType: "assortment",
        buffer: inputBuffer!,
        fileName: `${source}.${mode}`,
        source: mode,
        ...(mode === "csv" ? { encoding: "utf-8" as const, delimiter: "," as const } : {}),
      })
      const processed = await processNextCatalogImportJob(prisma)
      if (!processed || processed.jobId !== queued.jobId || processed.batchId !== queued.batchId) {
        throw new Error("queued assortment benchmark job was not processed")
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

    const rssBefore = process.memoryUsage().rss
    const firstStarted = performance.now()
    const first = await runImport("assortment-capacity-benchmark")
    const firstDurationMs = performance.now() - firstStarted
    const [matrixAfterFirst, storeAfterFirst] = await Promise.all([
      prisma.assortmentMatrix.count({ where: { formatId: format.id } }),
      prisma.storeAssortment.count({ where: { store: { organizationId: organization.id } } }),
    ])

    const replayStarted = performance.now()
    const replay = await runImport("assortment-capacity-benchmark-replay")
    const replayDurationMs = performance.now() - replayStarted
    const [matrixAfterReplay, storeAfterReplay] = await Promise.all([
      prisma.assortmentMatrix.count({ where: { formatId: format.id } }),
      prisma.storeAssortment.count({ where: { store: { organizationId: organization.id } } }),
    ])
    const rssAfter = process.memoryUsage().rss
    const expectedMatrix = Math.ceil(rowCount / 2)
    const expectedStore = Math.floor(rowCount / 2)

    if (
      first.status !== "COMPLETED" ||
      replay.status !== "COMPLETED" ||
      first.reconciliation.status !== "MATCH" ||
      replay.reconciliation.status !== "MATCH" ||
      first.reconciliation.sourceChecksum !== replay.reconciliation.sourceChecksum ||
      matrixAfterFirst !== expectedMatrix ||
      storeAfterFirst !== expectedStore ||
      matrixAfterReplay !== expectedMatrix ||
      storeAfterReplay !== expectedStore
    ) {
      throw new Error("assortment capacity benchmark integrity assertion failed")
    }

    console.log(JSON.stringify({
      rows: rowCount,
      mode,
      inputBytes: inputBuffer?.byteLength ?? null,
      first: {
        durationMs: Math.round(firstDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / firstDurationMs),
      },
      replay: {
        durationMs: Math.round(replayDurationMs),
        rowsPerSecond: Math.round((rowCount * 1_000) / replayDurationMs),
      },
      reconciliation: [first.reconciliation.status, replay.reconciliation.status],
      integrity: { matrixAfterFirst, storeAfterFirst, matrixAfterReplay, storeAfterReplay },
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
