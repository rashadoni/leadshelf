import { Prisma, type PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import {
  parsePriceRow,
  parseSalesRow,
  parseStockRow,
  type ParseResult,
  type RawCsvRow,
  type RowIssue,
} from "@leadshelf/core"
import { emitProductEvent } from "@leadshelf/db"
import { loadRefMaps, resolveProductId, type RefMaps } from "./resolve-refs"
import type { ImportSummary } from "./execute-products-import"

// Снапшоты пишутся raw INSERT ... ON CONFLICT: их natural keys — это
// UNIQUE NULLS NOT DISTINCT констрейнты (raw SQL миграции, Prisma их не
// видит, upsert по ним невозможен). Констрейнты: *_natural_key.

const CHUNK_SIZE = 500

type SnapshotEntity = "prices" | "stock" | "sales"

interface ResolvedSnapshotRow {
  productId: string
  storeId: string | null
  warehouseId: string | null
  date: string
  values: Record<string, string | null>
}

interface SnapshotConfig {
  parse(raw: RawCsvRow, rowNumber: number): ParseResult<Record<string, unknown>>
  resolve(
    row: Record<string, unknown>,
    rowNumber: number,
    maps: RefMaps,
    errors: RowIssue[],
  ): ResolvedSnapshotRow | null
  insertChunk(prisma: PrismaClient, organizationId: string, rows: ResolvedSnapshotRow[]): Promise<void>
}

function resolveCommon(
  row: { sku: string | null; barcode: string | null; storeCode?: string | null; warehouseCode?: string | null; date: string },
  rowNumber: number,
  maps: RefMaps,
  errors: RowIssue[],
): { productId: string; storeId: string | null; warehouseId: string | null } | null {
  const productId = resolveProductId(maps, row)
  if (!productId) {
    errors.push({
      rowNumber,
      field: "sku",
      reason: `товар не найден (sku=${row.sku ?? "-"}, barcode=${row.barcode ?? "-"})`,
      severity: "error",
      suggestedFix: "сначала импортируйте каталог товаров",
    })
    return null
  }
  let storeId: string | null = null
  if (row.storeCode) {
    storeId = maps.storeByCode.get(row.storeCode) ?? null
    if (!storeId) {
      errors.push({
        rowNumber,
        field: "storeCode",
        reason: `точка с кодом "${row.storeCode}" не найдена`,
        severity: "error",
        suggestedFix: "заведите точку или исправьте код; пустой storeCode = вся сеть",
      })
      return null
    }
  }
  let warehouseId: string | null = null
  if (row.warehouseCode) {
    warehouseId = maps.warehouseByCode.get(row.warehouseCode) ?? null
    if (!warehouseId) {
      errors.push({
        rowNumber,
        field: "warehouseCode",
        reason: `склад "${row.warehouseCode}" не найден`,
        severity: "error",
      })
      return null
    }
  }
  return { productId, storeId, warehouseId }
}

const CONFIGS: Record<SnapshotEntity, SnapshotConfig> = {
  prices: {
    parse: parsePriceRow as SnapshotConfig["parse"],
    resolve(row, rowNumber, maps, errors) {
      const r = row as { sku: string | null; barcode: string | null; storeCode: string | null; date: string; price: string; costPrice: string | null; currency: string }
      const ids = resolveCommon(r, rowNumber, maps, errors)
      if (!ids) return null
      return {
        ...ids,
        date: r.date,
        values: { price: r.price, costPrice: r.costPrice, currency: r.currency },
      }
    },
    async insertChunk(prisma, organizationId, rows) {
      const values = rows.map(
        (r) =>
          Prisma.sql`(${randomUUID()}, ${organizationId}, ${r.productId}, ${r.storeId}, ${r.date}::date, ${r.values.price}::decimal, ${r.values.costPrice}::decimal, ${r.values.currency})`,
      )
      await prisma.$executeRaw`
        INSERT INTO "price_snapshots" ("id", "organizationId", "productId", "storeId", "date", "price", "costPrice", "currency")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("productId", "storeId", "date")
        DO UPDATE SET "price" = EXCLUDED."price", "costPrice" = EXCLUDED."costPrice", "currency" = EXCLUDED."currency"`
    },
  },
  stock: {
    parse: parseStockRow as SnapshotConfig["parse"],
    resolve(row, rowNumber, maps, errors) {
      const r = row as { sku: string | null; barcode: string | null; storeCode: string | null; warehouseCode: string | null; date: string; quantity: string }
      const ids = resolveCommon(r, rowNumber, maps, errors)
      if (!ids) return null
      return { ...ids, date: r.date, values: { quantity: r.quantity } }
    },
    async insertChunk(prisma, organizationId, rows) {
      const values = rows.map(
        (r) =>
          Prisma.sql`(${randomUUID()}, ${organizationId}, ${r.productId}, ${r.storeId}, ${r.warehouseId}, ${r.date}::date, ${r.values.quantity}::decimal)`,
      )
      await prisma.$executeRaw`
        INSERT INTO "stock_snapshots" ("id", "organizationId", "productId", "storeId", "warehouseId", "date", "quantity")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("productId", "storeId", "warehouseId", "date")
        DO UPDATE SET "quantity" = EXCLUDED."quantity"`
    },
  },
  sales: {
    parse: parseSalesRow as SnapshotConfig["parse"],
    resolve(row, rowNumber, maps, errors) {
      const r = row as { sku: string | null; barcode: string | null; storeCode: string | null; date: string; quantity: string; revenue: string; profit: string | null }
      const ids = resolveCommon(r, rowNumber, maps, errors)
      if (!ids) return null
      return {
        ...ids,
        date: r.date,
        values: { quantity: r.quantity, revenue: r.revenue, profit: r.profit },
      }
    },
    async insertChunk(prisma, organizationId, rows) {
      const values = rows.map(
        (r) =>
          Prisma.sql`(${randomUUID()}, ${organizationId}, ${r.productId}, ${r.storeId}, ${r.date}::date, ${r.values.quantity}::decimal, ${r.values.revenue}::decimal, ${r.values.profit}::decimal)`,
      )
      await prisma.$executeRaw`
        INSERT INTO "sales_snapshots" ("id", "organizationId", "productId", "storeId", "date", "quantity", "revenue", "profit")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("productId", "storeId", "date")
        DO UPDATE SET "quantity" = EXCLUDED."quantity", "revenue" = EXCLUDED."revenue", "profit" = EXCLUDED."profit"`
    },
  },
}

export interface SnapshotsImportInput {
  organizationId: string
  entityType: SnapshotEntity
  rows: RawCsvRow[]
  source?: string
  createdById?: string
  batchId?: string
}

export async function executeSnapshotsImport(
  prisma: PrismaClient,
  input: SnapshotsImportInput,
): Promise<ImportSummary> {
  const { organizationId, entityType, rows } = input
  const config = CONFIGS[entityType]
  const batch = input.batchId
    ? await prisma.importBatch.update({
        where: { id: input.batchId },
        data: { status: "PROCESSING", startedAt: new Date(), createdById: input.createdById ?? null },
        select: { id: true },
      })
    : await prisma.importBatch.create({
        data: {
          organizationId,
          source: input.source ?? "csv",
          entityType,
          status: "PROCESSING",
          startedAt: new Date(),
          createdById: input.createdById ?? null,
        },
        select: { id: true },
      })

  const maps = await loadRefMaps(prisma, organizationId)
  let totalRows = 0
  let errorRows = 0
  let importedRows = 0

  try {
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + CHUNK_SIZE)
      const issues: Array<RowIssue & { sourceRow?: RawCsvRow }> = []
      // Дедупликация по natural key ВНУТРИ чанка: 1С регулярно выгружает
      // дубли, а multi-row ON CONFLICT не может обновить одну строку дважды.
      // Последняя строка файла побеждает, дубль фиксируется warning-ом.
      const resolved = new Map<string, ResolvedSnapshotRow>()

      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = offset + i + 2
        const raw = chunk[i]!
        totalRows++
        const parsed = config.parse(raw, rowNumber)
        if (!parsed.ok) {
          errorRows++
          issues.push(...parsed.errors.map((e) => ({ ...e, sourceRow: raw })), ...parsed.warnings)
          continue
        }
        const rowErrors: RowIssue[] = []
        const row = config.resolve(parsed.value, rowNumber, maps, rowErrors)
        if (!row) {
          errorRows++
          issues.push(...rowErrors.map((e) => ({ ...e, sourceRow: raw })))
          continue
        }
        const key = `${row.productId}|${row.storeId ?? ""}|${row.warehouseId ?? ""}|${row.date}`
        if (resolved.has(key)) {
          issues.push({
            rowNumber,
            field: "date",
            reason: "дубликат строки в файле по ключу товар/точка/дата — использована последняя",
            severity: "warning",
          })
        } else {
          importedRows++
        }
        resolved.set(key, row)
      }

      if (resolved.size > 0) {
        await config.insertChunk(prisma, organizationId, [...resolved.values()])
      }
      if (issues.length > 0) {
        await prisma.importError.createMany({
          data: issues.map((i2) => ({
            batchId: batch.id,
            rowNumber: i2.rowNumber,
            field: i2.field ?? null,
            reason: i2.reason,
            severity: i2.severity,
            suggestedFix: i2.suggestedFix ?? null,
            sourceRow: i2.sourceRow ?? undefined,
          })),
        })
      }
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: { totalRows, errorRows },
      })
    }

    const status = errorRows > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED"
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status, finishedAt: new Date() },
    })
    if (errorRows > 0) {
      await emitProductEvent(prisma, organizationId, {
        kind: "import.errors",
        severity: "warning",
        entityType: "importBatch",
        entityId: batch.id,
        dedupeKey: `import.errors:${batch.id}`,
        payload: { title: `${input.entityType} import errors`, count: errorRows, source: input.source ?? null },
      })
    }
    return { batchId: batch.id, totalRows, errorRows, importedRows, status }
  } catch (err) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", finishedAt: new Date() },
    })
    throw err
  }
}
