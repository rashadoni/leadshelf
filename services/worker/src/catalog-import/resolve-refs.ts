import type { PrismaClient } from "@leadshelf/prisma-client"

// Преднагруженные карты справочников для резолва строк импорта.
// Пилотный масштаб (до ~100k SKU) — загрузка целиком быстрее точечных запросов.

export interface RefMaps {
  productBySku: Map<string, string>
  productByBarcode: Map<string, string>
  storeByCode: Map<string, string>
  warehouseByCode: Map<string, string>
  formatByName: Map<string, string>
}

export async function loadRefMaps(
  prisma: PrismaClient,
  organizationId: string,
): Promise<RefMaps> {
  const [products, barcodes, stores, warehouses, formats] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId },
      select: { id: true, sku: true },
    }),
    prisma.productBarcode.findMany({
      where: { organizationId },
      select: { barcode: true, productId: true },
    }),
    prisma.store.findMany({
      where: { organizationId, code: { not: null } },
      select: { id: true, code: true },
    }),
    prisma.warehouse.findMany({
      where: { organizationId },
      select: { id: true, name: true, externalCode: true },
    }),
    prisma.storeFormat.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    }),
  ])

  const maps: RefMaps = {
    productBySku: new Map(products.map((p) => [p.sku, p.id])),
    productByBarcode: new Map(barcodes.map((b) => [b.barcode, b.productId])),
    storeByCode: new Map(stores.map((s) => [s.code!, s.id])),
    warehouseByCode: new Map(),
    formatByName: new Map(formats.map((f) => [f.name.toLowerCase(), f.id])),
  }
  for (const w of warehouses) {
    if (w.externalCode) maps.warehouseByCode.set(w.externalCode, w.id)
    maps.warehouseByCode.set(w.name, w.id)
  }
  return maps
}

export function resolveProductId(
  maps: RefMaps,
  ref: { sku: string | null; barcode: string | null },
): string | null {
  if (ref.sku) {
    const bySku = maps.productBySku.get(ref.sku)
    if (bySku) return bySku
  }
  if (ref.barcode) {
    const byBarcode = maps.productByBarcode.get(ref.barcode)
    if (byBarcode) return byBarcode
  }
  return null
}
