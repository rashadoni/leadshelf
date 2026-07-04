import type { PrismaClient } from "@prisma/client"
import { parseAssortmentRow, type RawCsvRow, type RowIssue } from "@leadshelf/core"
import { emitProductEvent } from "@leadshelf/db"
import { loadRefMaps, resolveProductId } from "./resolve-refs"
import type { ImportSummary } from "./execute-products-import"

// Ассортимент: scope=format -> AssortmentMatrix (упр. всей сетью формата),
// scope=store -> StoreAssortment (точечные исключения поверх матрицы).
// Неизвестные формат/точка/товар — ImportError, НЕ авто-создание: справочники
// заводятся своими импортами, молчаливое создание маскирует ошибки данных.

const CHUNK_SIZE = 500

export interface AssortmentImportInput {
  organizationId: string
  rows: RawCsvRow[]
  source?: string
  createdById?: string
  batchId?: string
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
  let totalRows = 0
  let errorRows = 0
  let importedRows = 0

  try {
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + CHUNK_SIZE)
      const issues: Array<RowIssue & { sourceRow?: RawCsvRow }> = []

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
            await prisma.assortmentMatrix.upsert({
              where: { formatId_productId: { formatId: formatId!, productId: productId! } },
              update: { isActive: row.isActive, validFrom, validTo },
              create: {
                formatId: formatId!,
                productId: productId!,
                isActive: row.isActive,
                validFrom,
                validTo,
              },
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
            await prisma.storeAssortment.upsert({
              where: { storeId_productId: { storeId: storeId!, productId: productId! } },
              update: { isActive: row.isActive, validFrom, validTo },
              create: {
                storeId: storeId!,
                productId: productId!,
                isActive: row.isActive,
                validFrom,
                validTo,
              },
            })
          }
        }

        if (rowErrors.length > 0) {
          errorRows++
          issues.push(...rowErrors.map((e) => ({ ...e, sourceRow: raw })))
        } else {
          importedRows++
        }
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
        payload: { title: "Assortment import errors", count: errorRows, source: input.source ?? null },
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
