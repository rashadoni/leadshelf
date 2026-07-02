import { tenantDb } from "../db/client"

// Общие запросы качества данных: используются и API-роутом, и страницей.

export async function getCatalogQuality(organizationId: string) {
  const db = tenantDb(organizationId)
  const activeOnly = { isActive: true }

  const [total, missingDimensions, missingBarcode, missingImage, missingCategory, recentBatches] =
    await Promise.all([
      db.product.count({ where: activeOnly }),
      db.product.count({
        where: { ...activeOnly, OR: [{ widthMm: null }, { heightMm: null }, { depthMm: null }] },
      }),
      db.product.count({ where: { ...activeOnly, barcodes: { none: {} } } }),
      db.product.count({ where: { ...activeOnly, images: { none: {} } } }),
      db.product.count({ where: { ...activeOnly, categoryId: null } }),
      db.importBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          entityType: true,
          status: true,
          totalRows: true,
          errorRows: true,
          createdAt: true,
        },
      }),
    ])

  return {
    products: {
      total,
      missingDimensions,
      missingBarcode,
      missingImage,
      missingCategory,
      planogramReady: total - missingDimensions,
    },
    recentBatches,
  }
}
