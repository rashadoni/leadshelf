import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "@leadshelf/db"
import { executeProductsImport } from "./execute-products-import"
import { executeSnapshotsImport } from "./execute-snapshots-import"
import { executeAssortmentImport } from "./execute-assortment-import"

const prisma = createSystemClient("worker-snapshots-test")
const slug = `test-snap-${Date.now()}`
let orgId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Snap Test", slug } })
  orgId = org.id
  const format = await prisma.storeFormat.create({
    data: { organizationId: orgId, name: "Standart" },
  })
  await prisma.store.create({
    data: { organizationId: orgId, name: "Аптека 1", code: "ST-1", formatId: format.id },
  })
  await executeProductsImport(prisma, {
    organizationId: orgId,
    rows: [
      { sku: "P-1", name: "Товар 1", barcode: "4600000000001" },
      { sku: "P-2", name: "Товар 2" },
    ],
  })
})

afterAll(async () => {
  // порядок важен: снапшоты и ассортимент держат продукты/точки через
  // Restrict (защита истории) — чистим их до каскада от org
  await prisma.priceSnapshot.deleteMany({ where: { organizationId: orgId } })
  await prisma.stockSnapshot.deleteMany({ where: { organizationId: orgId } })
  await prisma.salesSnapshot.deleteMany({ where: { organizationId: orgId } })
  await prisma.assortmentMatrix.deleteMany({ where: { format: { organizationId: orgId } } })
  await prisma.storeAssortment.deleteMany({ where: { store: { organizationId: orgId } } })
  await prisma.externalIdMap.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("executeSnapshotsImport", () => {
  test("prices: org-wide (NULL storeId) и точечная; двойной прогон без дублей", async () => {
    const rows = [
      // org-wide цена: storeCode пуст -> storeId NULL (NULLS NOT DISTINCT ключ!)
      { Артикул: "P-1", Дата: "01.07.2026", Цена: "12,50" },
      { sku: "P-1", date: "2026-07-01", storecode: "ST-1", price: "13.00" },
      // товар по штрих-коду
      { barcode: "4600000000001", date: "2026-07-02", price: "12.90" },
      // неизвестная точка -> error
      { sku: "P-2", date: "2026-07-01", storecode: "NO-SUCH", price: "1.00" },
      // неизвестный товар -> error
      { sku: "GHOST", date: "2026-07-01", price: "1.00" },
    ]
    const s1 = await executeSnapshotsImport(prisma, {
      organizationId: orgId,
      entityType: "prices",
      rows,
    })
    expect(s1.totalRows).toBe(5)
    expect(s1.errorRows).toBe(2)
    expect(s1.importedRows).toBe(3)
    expect(await prisma.priceSnapshot.count({ where: { organizationId: orgId } })).toBe(3)

    // двойной прогон с измененной ценой: те же 3 строки, но цена обновилась
    const s2 = await executeSnapshotsImport(prisma, {
      organizationId: orgId,
      entityType: "prices",
      rows: [{ Артикул: "P-1", Дата: "01.07.2026", Цена: "14,00" }, ...rows.slice(1)],
    })
    expect(s2.errorRows).toBe(2)
    expect(await prisma.priceSnapshot.count({ where: { organizationId: orgId } })).toBe(3)
    const orgWide = await prisma.priceSnapshot.findFirst({
      where: { organizationId: orgId, storeId: null, date: new Date("2026-07-01") },
    })
    expect(orgWide?.price.toString()).toBe("14")
  })

  test("stock и sales: идемпотентная запись", async () => {
    const stock = await executeSnapshotsImport(prisma, {
      organizationId: orgId,
      entityType: "stock",
      rows: [
        { sku: "P-1", date: "2026-07-01", storecode: "ST-1", quantity: "25" },
        { sku: "P-1", date: "2026-07-01", storecode: "ST-1", quantity: "25" }, // дубль в файле
      ],
    })
    expect(stock.status).toBe("COMPLETED")
    expect(await prisma.stockSnapshot.count({ where: { organizationId: orgId } })).toBe(1)

    const sales = await executeSnapshotsImport(prisma, {
      organizationId: orgId,
      entityType: "sales",
      rows: [
        {
          sku: "P-1",
          date: "2026-07-01",
          storecode: "ST-1",
          quantity: "5",
          revenue: "62,50",
          profit: "12,00",
        },
      ],
    })
    expect(sales.errorRows).toBe(0)
    const row = await prisma.salesSnapshot.findFirst({ where: { organizationId: orgId } })
    expect(row?.revenue.toString()).toBe("62.5")
  })
})

describe("executeAssortmentImport", () => {
  test("матрица формата + точечное исключение + неизвестный формат", async () => {
    const s = await executeAssortmentImport(prisma, {
      organizationId: orgId,
      rows: [
        { sku: "P-1", scope: "format", format: "Standart", isactive: "да" },
        { sku: "P-1", scope: "store", storecode: "ST-1", isactive: "нет" },
        { sku: "P-2", scope: "format", format: "Premium", isactive: "да" }, // нет формата
      ],
    })
    const inOrg = { where: { format: { organizationId: orgId } } }
    expect(s.totalRows).toBe(3)
    expect(s.errorRows).toBe(1)
    expect(await prisma.assortmentMatrix.count(inOrg)).toBe(1)
    const exception = await prisma.storeAssortment.findFirst({
      where: { store: { organizationId: orgId } },
    })
    expect(exception?.isActive).toBe(false)

    // двойной прогон -> без дублей
    await executeAssortmentImport(prisma, {
      organizationId: orgId,
      rows: [{ sku: "P-1", scope: "format", format: "Standart", isactive: "да" }],
    })
    expect(await prisma.assortmentMatrix.count(inOrg)).toBe(1)
  })
})
