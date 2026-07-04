import type { PrismaClient } from "@prisma/client"
import {
  parseCategoryPath,
  parseProductRow,
  type RawCsvRow,
  type RowIssue,
} from "@leadshelf/core"
import type { ProductImportRowV1 } from "@leadshelf/api-contracts/import/v1"
import { emitProductEvent } from "@leadshelf/db"

// Исполнитель импорта товаров. Работает через system client ("import-worker"):
// bulk upsert-ы по natural keys требуют операций, которые tenant client
// осознанно блокирует. КАЖДЫЙ запрос обязан включать organizationId.

const CHUNK_SIZE = 500
const EXTERNAL_SYSTEM = "staging.v1"

export interface ProductsImportInput {
  organizationId: string
  rows: RawCsvRow[]
  source?: string
  createdById?: string
  batchId?: string
}

export interface ImportSummary {
  batchId: string
  totalRows: number
  errorRows: number
  importedRows: number
  status: "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED"
}

interface RefCaches {
  brand: Map<string, string>
  supplier: Map<string, string>
  manufacturer: Map<string, string>
  category: Map<string, string>
}

async function ensureName(
  prisma: PrismaClient,
  model: "brand" | "supplier" | "manufacturer",
  organizationId: string,
  name: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = name.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  // upsert по [organizationId, name]; регистр имени сохраняем как в файле
  const delegate = prisma[model] as unknown as {
    upsert(args: object): Promise<{ id: string }>
  }
  const row = await delegate.upsert({
    where: { organizationId_name: { organizationId, name } },
    update: {},
    create: { organizationId, name },
  })
  cache.set(key, row.id)
  return row.id
}

async function ensureCategoryPath(
  prisma: PrismaClient,
  organizationId: string,
  pathRaw: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const path = parseCategoryPath(pathRaw)
  if (!path) return null
  let parentId: string | null = null
  for (let i = 0; i < path.segments.length; i++) {
    const levelPath = path.levelPaths[i]!
    const cached = cache.get(levelPath)
    if (cached) {
      parentId = cached
      continue
    }
    // явная аннотация разрывает циклический вывод типов (parentId <- cat.id)
    const cat: { id: string } = await prisma.category.upsert({
      where: {
        organizationId_normalizedPath: { organizationId, normalizedPath: levelPath },
      },
      update: {},
      create: {
        organizationId,
        name: path.segments[i]!,
        normalizedPath: levelPath,
        parentId,
      },
      select: { id: true },
    })
    cache.set(levelPath, cat.id)
    parentId = cat.id
  }
  return parentId
}

async function importOneProduct(
  prisma: PrismaClient,
  organizationId: string,
  row: ProductImportRowV1,
  rowNumber: number,
  caches: RefCaches,
): Promise<RowIssue[]> {
  const issues: RowIssue[] = []

  const brandId = row.brandName
    ? await ensureName(prisma, "brand", organizationId, row.brandName, caches.brand)
    : null
  const supplierId = row.supplierName
    ? await ensureName(prisma, "supplier", organizationId, row.supplierName, caches.supplier)
    : null
  const manufacturerId = row.manufacturerName
    ? await ensureName(
        prisma,
        "manufacturer",
        organizationId,
        row.manufacturerName,
        caches.manufacturer,
      )
    : null

  let categoryId: string | null = null
  if (row.categoryPath) {
    categoryId = await ensureCategoryPath(prisma, organizationId, row.categoryPath, caches.category)
  } else if (row.categoryCode) {
    const byCode = await prisma.category.findFirst({
      where: { organizationId, externalCode: row.categoryCode },
      select: { id: true },
    })
    if (byCode) {
      categoryId = byCode.id
    } else {
      issues.push({
        rowNumber,
        field: "categoryCode",
        reason: `категория с кодом "${row.categoryCode}" не найдена`,
        severity: "warning",
        suggestedFix: "импортируйте категории или используйте categoryPath",
      })
    }
  }

  const data = {
    name: row.name,
    unit: row.unit,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    depthMm: row.depthMm,
    weightG: row.weightG,
    isSoftPack: row.isSoftPack,
    isActive: row.isActive,
    brandId,
    supplierId,
    manufacturerId,
    categoryId,
  }
  const product = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId, sku: row.sku } },
    update: data,
    create: { organizationId, sku: row.sku, ...data },
  })

  if (row.barcode) {
    const existing = await prisma.productBarcode.findUnique({
      where: { organizationId_barcode: { organizationId, barcode: row.barcode } },
      select: { productId: true },
    })
    if (existing && existing.productId !== product.id) {
      issues.push({
        rowNumber,
        field: "barcode",
        reason: `штрих-код ${row.barcode} уже принадлежит другому товару`,
        severity: "error",
        suggestedFix: "проверьте дубликат в выгрузке; товар импортирован без штрих-кода",
      })
    } else if (!existing) {
      const hasPrimary = await prisma.productBarcode.findFirst({
        where: { productId: product.id, isPrimary: true },
        select: { id: true },
      })
      await prisma.productBarcode.create({
        data: {
          organizationId,
          productId: product.id,
          barcode: row.barcode,
          isPrimary: !hasPrimary,
        },
      })
    }
  }

  if (row.externalId) {
    await prisma.externalIdMap.upsert({
      where: {
        organizationId_system_entityType_externalId: {
          organizationId,
          system: EXTERNAL_SYSTEM,
          entityType: "product",
          externalId: row.externalId,
        },
      },
      update: { internalId: product.id },
      create: {
        organizationId,
        system: EXTERNAL_SYSTEM,
        entityType: "product",
        externalId: row.externalId,
        internalId: product.id,
      },
    })
  }

  return issues
}

export async function executeProductsImport(
  prisma: PrismaClient,
  input: ProductsImportInput,
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
          entityType: "products",
          status: "PROCESSING",
          startedAt: new Date(),
          createdById: input.createdById ?? null,
        },
        select: { id: true },
      })

  const caches: RefCaches = {
    brand: new Map(),
    supplier: new Map(),
    manufacturer: new Map(),
    category: new Map(),
  }
  let totalRows = 0
  let errorRows = 0
  let importedRows = 0

  try {
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + CHUNK_SIZE)
      const chunkIssues: Array<RowIssue & { sourceRow?: RawCsvRow }> = []

      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = offset + i + 2 // +2: 1-based + строка заголовков
        const raw = chunk[i]!
        totalRows++

        const parsed = parseProductRow(raw, rowNumber)
        if (!parsed.ok) {
          errorRows++
          chunkIssues.push(
            ...parsed.errors.map((e) => ({ ...e, sourceRow: raw })),
            ...parsed.warnings,
          )
          continue
        }
        chunkIssues.push(...parsed.warnings)

        const rowIssues = await importOneProduct(
          prisma,
          organizationId,
          parsed.value,
          rowNumber,
          caches,
        )
        if (rowIssues.some((i2) => i2.severity === "error")) errorRows++
        else importedRows++
        chunkIssues.push(...rowIssues)
      }

      if (chunkIssues.length > 0) {
        await prisma.importError.createMany({
          data: chunkIssues.map((i2) => ({
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
        payload: { title: "Product import errors", count: errorRows, source: input.source ?? null },
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
