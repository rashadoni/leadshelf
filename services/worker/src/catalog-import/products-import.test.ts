import { afterAll, beforeAll, describe, expect, test } from "vitest"
import iconv from "iconv-lite"
import { createSystemClient } from "@leadshelf/db"
import type { RawCsvRow } from "@leadshelf/core"
import { executeProductsImport } from "./execute-products-import"
import { readCsvRecords } from "./csv"

const prisma = createSystemClient("worker-integration-test")
const slug = `test-import-${Date.now()}`
let orgId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: "Import Test Org", slug },
  })
  orgId = org.id
})

afterAll(async () => {
  await prisma.externalIdMap.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

const ROWS: RawCsvRow[] = [
  {
    Артикул: "A-100",
    Наименование: "Парацетамол 500мг",
    "Штрих-код": "4600000000017",
    Категория: "OTC / Обезболивающие",
    Бренд: "Авексима",
    "Ед.изм": "шт",
    Ширина: "45",
    Высота: "120",
    Глубина: "30",
    id1c: "1c-guid-100",
  },
  { sku: "B-200", name: "Минимальный товар" }, // без штрих-кода и размеров -> warnings
  { sku: "C-300", name: "Ящичный товар", unit: "ящик", brand: "Авексима" },
  { sku: "", name: "" }, // битая строка -> error
  { sku: "D-400", name: "Конфликт штрих-кода", barcode: "4600000000017" },
]

describe("executeProductsImport", () => {
  test("первый прогон: товары, категории, бренды, ошибки", async () => {
    const summary = await executeProductsImport(prisma, { organizationId: orgId, rows: ROWS })

    expect(summary.totalRows).toBe(5)
    expect(summary.errorRows).toBe(2) // битая строка + конфликт штрих-кода
    expect(summary.importedRows).toBe(3)
    expect(summary.status).toBe("COMPLETED_WITH_ERRORS")

    expect(await prisma.product.count({ where: { organizationId: orgId } })).toBe(4)

    const a100 = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: "A-100" } },
      include: { category: true, brand: true, barcodes: true },
    })
    expect(a100?.widthMm).toBe(45)
    expect(a100?.unit).toBe("PCS")
    expect(a100?.category?.normalizedPath).toBe("otc/обезболивающие")
    expect(a100?.brand?.name).toBe("Авексима")
    expect(a100?.barcodes[0]?.barcode).toBe("4600000000017")

    // дерево категорий: 2 уровня
    expect(await prisma.category.count({ where: { organizationId: orgId } })).toBe(2)
    // бренд один, не задублирован между строками
    expect(await prisma.brand.count({ where: { organizationId: orgId } })).toBe(1)
    // единица из словаря
    const c300 = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: "C-300" } },
    })
    expect(c300?.unit).toBe("BOX")
    // штрих-код НЕ ушел к товару-конфликту
    const d400 = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: "D-400" } },
      include: { barcodes: true },
    })
    expect(d400?.barcodes).toHaveLength(0)
    // ExternalIdMap создан
    expect(
      await prisma.externalIdMap.count({
        where: { organizationId: orgId, externalId: "1c-guid-100" },
      }),
    ).toBe(1)

    // ImportError-ы: ошибка по name, конфликт barcode, warning по размерам
    const errors = await prisma.importError.findMany({ where: { batchId: summary.batchId } })
    expect(errors.some((e) => e.field === "name" && e.severity === "error")).toBe(true)
    expect(errors.some((e) => e.field === "barcode" && e.reason.includes("другому товару"))).toBe(
      true,
    )
    expect(errors.some((e) => e.severity === "warning" && e.field === "widthMm")).toBe(true)
  })

  test("двойной прогон: идемпотентность + upsert обновляет поля", async () => {
    const rerun = ROWS.map((r) =>
      r["Артикул"] === "A-100" ? { ...r, Наименование: "Парацетамол 500мг N20" } : r,
    )
    const summary = await executeProductsImport(prisma, { organizationId: orgId, rows: rerun })

    // те же счетчики, ни одного нового товара/категории/бренда/штрих-кода
    expect(summary.errorRows).toBe(2)
    expect(await prisma.product.count({ where: { organizationId: orgId } })).toBe(4)
    expect(await prisma.category.count({ where: { organizationId: orgId } })).toBe(2)
    expect(await prisma.brand.count({ where: { organizationId: orgId } })).toBe(1)
    expect(await prisma.productBarcode.count({ where: { organizationId: orgId } })).toBe(1)

    // а имя обновилось (upsert.update)
    const a100 = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: "A-100" } },
    })
    expect(a100?.name).toBe("Парацетамол 500мг N20")
  })
})

describe("readCsvRecords", () => {
  test("windows-1251 + точка с запятой + кириллические заголовки", () => {
    const csv = "Артикул;Наименование;Цена\nA-1;Товар со скидкой;12,50\n"
    const buffer = iconv.encode(csv, "win1251")
    const rows = readCsvRecords(buffer, { encoding: "windows-1251" })
    expect(rows).toHaveLength(1)
    expect(rows[0]!["Артикул"]).toBe("A-1")
    expect(rows[0]!["Наименование"]).toBe("Товар со скидкой")
  })

  test("utf-8 с BOM и запятой", () => {
    const rows = readCsvRecords(Buffer.from("﻿sku,name\nX-1,Test\n", "utf-8"))
    expect(rows[0]!.sku).toBe("X-1")
  })
})
