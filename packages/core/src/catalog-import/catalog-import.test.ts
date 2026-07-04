import { describe, expect, test } from "vitest"
import { parseProductRow } from "./parse-product-row"
import { parsePriceRow, parseSalesRow, parseStockRow } from "./parse-snapshot-rows"
import { parseAssortmentRow } from "./parse-assortment-row"
import { parseCategoryPath } from "./categories"
import { parseBarcode, parseDateOnly, parseDecimal } from "./primitives"
import { parseUnit } from "./units"

describe("primitives", () => {
  test("decimal: запятая 1С -> точка, тысячные пробелы", () => {
    expect(parseDecimal("12,50")).toBe("12.50")
    expect(parseDecimal("1 234,56")).toBe("1234.56")
    expect(parseDecimal("1.234,56")).toBe("1234.56")
    expect(parseDecimal("1234.56")).toBe("1234.56")
    expect(parseDecimal("abc")).toBeNull()
  })

  test("date: ISO и dd.mm.yyyy", () => {
    expect(parseDateOnly("2026-07-02")).toBe("2026-07-02")
    expect(parseDateOnly("02.07.2026")).toBe("2026-07-02")
    expect(parseDateOnly("31.02.2026")).toBeNull()
  })

  test("barcode: ведущие нули сохраняются, Excel-нотация = ошибка", () => {
    expect(parseBarcode("0000123456789")).toEqual({ ok: true, barcode: "0000123456789" })
    expect(parseBarcode("4,60483E+12")).toEqual({ ok: false, reason: "excel_mangled" })
    expect(parseBarcode("4.60483E+12")).toEqual({ ok: false, reason: "excel_mangled" })
    expect(parseBarcode("abc")).toEqual({ ok: false, reason: "invalid" })
  })

  test("unit: словарь ru/az/en, default PCS", () => {
    expect(parseUnit("шт")).toBe("PCS")
    expect(parseUnit("ЯЩИК")).toBe("BOX")
    expect(parseUnit("ədəd")).toBe("PCS")
    expect(parseUnit(null)).toBe("PCS")
    expect(parseUnit("бочка")).toBeNull()
  })

  test("category path: нормализация и уровни", () => {
    const p = parseCategoryPath(" OTC /  Обезболивающие/Таблетки ")!
    expect(p.segments).toEqual(["OTC", "Обезболивающие", "Таблетки"])
    expect(p.normalizedPath).toBe("otc/обезболивающие/таблетки")
    expect(p.levelPaths).toEqual([
      "otc",
      "otc/обезболивающие",
      "otc/обезболивающие/таблетки",
    ])
  })
})

describe("parseProductRow", () => {
  test("русские заголовки + BOM + габариты", () => {
    const r = parseProductRow(
      {
        "﻿Артикул": "A-100",
        Наименование: "Парацетамол 500мг",
        "Штрих-код": "4600000000017",
        Категория: "OTC / Обезболивающие",
        Бренд: "Авексима",
        "Ед.изм": "шт",
        Ширина: "45",
        Высота: "120",
        Глубина: "30",
        "Мягкая упаковка": "да",
      },
      2,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.sku).toBe("A-100")
      expect(r.value.unit).toBe("PCS")
      expect(r.value.widthMm).toBe(45)
      expect(r.value.isSoftPack).toBe(true)
      expect(r.value.barcode).toBe("4600000000017")
      expect(r.warnings).toHaveLength(0)
    }
  })

  test("накопление НЕСКОЛЬКИХ ошибок за один проход", () => {
    const r = parseProductRow({ name: "", unit: "бочка", width: "-5" }, 3)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field)
      expect(fields).toContain("sku")
      expect(fields).toContain("name")
      expect(fields).toContain("unit")
      expect(fields).toContain("widthMm")
      expect(r.errors.every((e) => e.rowNumber === 3)).toBe(true)
    }
  })

  test("отсутствие штрих-кода и размеров -> warnings, не ошибки", () => {
    const r = parseProductRow({ sku: "B-1", name: "Товар" }, 4)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const wf = r.warnings.map((w) => w.field)
      expect(wf).toContain("barcode")
      expect(wf).toContain("widthMm")
    }
  })

  test("Excel-битый штрих-код -> ошибка с подсказкой", () => {
    const r = parseProductRow({ sku: "C-1", name: "X", barcode: "4,60483E+12" }, 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]!.suggestedFix).toMatch(/текст/)
  })
})

describe("snapshot rows", () => {
  test("price: запятая в цене, дата 1С, storeCode опционален", () => {
    const r = parsePriceRow(
      { Артикул: "A-100", Дата: "01.07.2026", Цена: "12,50", Себестоимость: "8,00" },
      2,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.price).toBe("12.50")
      expect(r.value.date).toBe("2026-07-01")
      expect(r.value.storeCode).toBeNull()
      expect(r.value.currency).toBe("AZN")
    }
  })

  test("stock: количество обязательно", () => {
    const r = parseStockRow({ sku: "A-100", date: "2026-07-01" }, 2)
    expect(r.ok).toBe(false)
  })

  test("sales: revenue не может быть отрицательным, profit может", () => {
    const bad = parseSalesRow(
      { sku: "A", date: "2026-07-01", quantity: "5", revenue: "-10" },
      2,
    )
    expect(bad.ok).toBe(false)
    const ok = parseSalesRow(
      { sku: "A", date: "2026-07-01", quantity: "5", revenue: "100", profit: "-3,5" },
      3,
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.profit).toBe("-3.5")
  })

  test("без sku и barcode -> ошибка", () => {
    const r = parsePriceRow({ date: "2026-07-01", price: "1" }, 2)
    expect(r.ok).toBe(false)
  })
})

describe("parseAssortmentRow", () => {
  test("format-scope с русским словарем", () => {
    const r = parseAssortmentRow(
      { Артикул: "A-100", scope: "Формат", Формат: "Standart", isActive: "да" },
      2,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.scope).toBe("format")
      expect(r.value.formatName).toBe("Standart")
      expect(r.value.isActive).toBe(true)
    }
  })

  test("store-scope без storeCode -> ошибка", () => {
    const r = parseAssortmentRow({ sku: "A", scope: "store" }, 2)
    expect(r.ok).toBe(false)
  })
})
