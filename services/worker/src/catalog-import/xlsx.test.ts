import { describe, expect, test } from "vitest"
import * as XLSX from "xlsx"
import { readXlsxRecords } from "./xlsx"
import { parseProductRow } from "@leadshelf/core"

function makeXlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Лист1")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("readXlsxRecords", () => {
  test("русские заголовки, числа приходят строками", () => {
    const buf = makeXlsx([
      ["Артикул", "Наименование", "Ширина"],
      ["A-1", "Товар из Excel", 45],
    ])
    const rows = readXlsxRecords(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0]!["Артикул"]).toBe("A-1")
    expect(rows[0]!["Ширина"]).toBe("45")

    const parsed = parseProductRow(rows[0]!, 2)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.widthMm).toBe(45)
  })

  test("числовой штрих-код в general-формате ловится как excel_mangled", () => {
    // Excel хранит 4600000000017 числом и отображает научной нотацией
    const buf = makeXlsx([
      ["sku", "name", "barcode"],
      ["B-1", "X", 4600000000017],
    ])
    const rows = readXlsxRecords(buf)
    const parsed = parseProductRow(rows[0]!, 2)
    // raw:false отдает отображаемое значение: либо полное число (тогда ок),
    // либо научная нотация (тогда ошибка с подсказкой) — оба исхода валидны,
    // но молчаливой порчи ведущих нулей быть не должно
    if (parsed.ok) {
      expect(parsed.value.barcode).toBe("4600000000017")
    } else {
      expect(parsed.errors.some((e) => e.field === "barcode")).toBe(true)
    }
  })

  test("пустой файл -> пустой список", () => {
    const buf = makeXlsx([["sku", "name"]])
    expect(readXlsxRecords(buf)).toHaveLength(0)
  })
})
