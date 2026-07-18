import type { PrismaClient } from "@prisma/client"
import { parseAssortmentRow, type RawCsvRow, type RowIssue } from "@leadshelf/core"
import { emitProductEvent } from "@leadshelf/db"
import { loadRefMaps, resolveProductId } from "./resolve-refs"
import type { ImportSummary } from "./execute-products-import"
import { buildImportReconciliation } from "./reconciliation"
import { mapWithConcurrency } from "../concurrency/map-with-concurrency"

// Ассортимент: scope=format -> AssortmentMatrix (упр. всей сетью формата),
// scope=store -> StoreAssortment (точечные исключения поверх матрицы).
// Неизвестные формат/точка/товар — ImportError, НЕ авто-создание: справочники
// заводятся своими импортами, молчаливое создание маскирует ошибки данных.

const CHUNK_SIZE = 500

function assortmentConcurrency(): number {
  const configured = Number(process.env.LEADSHELF_ASSORTMENT_IMPORT_CONCURRENCY ?? 16)
  return Number.isInteger(configured) && configured >= 1 && configured <= 32 ? configured : 16
}

export interface AssortmentImportInput {
  organizationId: string
  rows: RawCsvRow[]
  source?: string
  createdById?: string
  batchId?: string
  expectedRows?: number
  expectedChecksum?: string
}

export async function executeAssortmentImport(
  prisma: PrismaClient,
  input: AssortmentImportInput,
): Promise<ImportSummary> {
  const { organizationId, rows } = input
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
          entityType: "assortment",
          status: "PROCESSING",
          startedAt: new Date(),
          createdById: input.createdById ?? null,
        },
        select: { id: true },
      })

  const maps = await loadRefMaps(prisma, organizationId)
  const concurrency = assortmentConcurrency()
  let totalRows = 0
  let errorRows = 0
  let importedRows = 0

  try {
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + CHUNK_SIZE)
      const issues: Array<RowIssue & { sourceRow?: RawCsvRow }> = []
      const operations: Array<{ key: string; run: () => Promise<unknown> }> = []

      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = offset + i + 2
        const raw = chunk[i]!
        totalRows++

        const parsed = parseAssortmentRow(raw, rowNumber)
        if (!parsed.ok) {
          errorRows++
          issues.push(...parsed.errors.map((e) => ({ ...e, sourceRow: raw })), ...parsed.warnings)
          continue
        }
        const row = parsed.value
        const rowErrors: RowIssue[] = []

        const productId = resolveProductId(maps, row)
        if (!productId) {
          rowErrors.push({
            rowNumber,
            field: "sku",
            reason: `товар не найден (sku=${row.sku ?? "-"}, barcode=${row.barcode ?? "-"})`,
            severity: "error",
            suggestedFix: "сначала импортируйте каталог товаров",
          })
        }

        const validFrom = row.validFrom ? new Date(`${row.validFrom}T00:00:00Z`) : null
        const validTo = row.validTo ? new Date(`${row.validTo}T00:00:00Z`) : null

        if (row.scope === "format") {
          const formatId = maps.formatByName.get(row.formatName!.toLowerCase())
          if (!formatId) {
            rowErrors.push({
              rowNumber,
              field: "formatName",
              reason: `формат "${row.formatName}" не найден`,
              severity: "error",
              suggestedFix: "заведите формат в разделе точек",
            })
          }
          if (rowErrors.length === 0) {
            const resolvedFormatId = formatId!
            const resolvedProductId = productId!
            operations.push({
              key: `format:${resolvedFormatId}:${resolvedProductId}`,
              run: () => prisma.assortmentMatrix.upsert({
                where: {
                  formatId_productId: {
                    formatId: resolvedFormatId,
                    productId: resolvedProductId,
                  },
                },
                update: { isActive: row.isActive, validFrom, validTo },
                create: {
                  formatId: resolvedFormatId,
                  productId: resolvedProductId,
                  isActive: row.isActive,
                  validFrom,
                  validTo,
                },
              }),
            })
          }
        } else {
          const storeId = maps.storeByCode.get(row.storeCode!)
          if (!storeId) {
            rowErrors.push({
              rowNumber,
              field: "storeCode",
              reason: `точка с кодом "${row.storeCode}" не найдена`,
              severity: "error",
            })
          }
          if (rowErrors.length === 0) {
            const resolvedStoreId = storeId!
            const resolvedProductId = productId!
            operations.push({
              key: `store:${resolvedStoreId}:${resolvedProductId}`,
              run: () => prisma.storeAssortment.upsert({
                where: {
                  storeId_productId: {
                    storeId: resolvedStoreId,
                    productId: resolvedProductId,
                  },
                },
                update: { isActive: row.isActive, validFrom, validTo },
                create: {
                  storeId: resolvedStoreId,
                  productId: resolvedProductId,
                  isActive: row.isActive,
                  validFrom,
                  validTo,
                },
              }),
            })
          }
        }

        if (rowErrors.length > 0) {
          errorRows++
          issues.push(...rowErrors.map((e) => ({ ...e, sourceRow: raw })))
        }
      }

      const operationGroups = new Map<string, typeof operations>()
      for (const operation of operations) {
        const group = operationGroups.get(operation.key)
        if (group) group.push(operation)
        else operationGroups.set(operation.key, [operation])
      }
      await mapWithConcurrency([...operationGroups.values()], concurrency, async (group) => {
        for (const operation of group) await operation.run()
      })
      importedRows += operations.length

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

    const reconciliation = buildImportReconciliation({
      rows,
      processedRows: totalRows,
      importedRows,
      errorRows,
      expectedRows: input.expectedRows,
      expectedChecksum: input.expectedChecksum,
    })
    const status = errorRows > 0 || reconciliation.status === "MISMATCH" ? "COMPLETED_WITH_ERRORS" : "COMPLETED"
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status, finishedAt: new Date(), reconciliation },
    })
    if (errorRows > 0) {
      await emitProductEvent(prisma, organizationId, {
        kind: "import.errors",
        severity: "warning",
        entityType: "importBatch",
        entityId: batch.id,
        dedupeKey: `import.errors:${batch.id}`,
        payload: { title: "Assortment import errors", count: errorRows, source: input.source ?? null },
      })
    }
    return { batchId: batch.id, totalRows, errorRows, importedRows, status, reconciliation }
  } catch (err) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", finishedAt: new Date() },
    })
    throw err
  }
}
