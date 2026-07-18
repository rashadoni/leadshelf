import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"
import { readXlsxRecords } from "./xlsx"
import { parseProductRow } from "@leadshelf/core"

async function makeXlsx(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Лист1")
  sheet.addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("readXlsxRecords", () => {
  test("русские заголовки, числа приходят строками", async () => {
    const buf = await makeXlsx([
      ["Артикул", "Наименование", "Ширина"],
      ["A-1", "Товар из Excel", 45],
    ])
    const rows = await readXlsxRecords(buf)
    expect(rows).toHaveLength(1)
    expect(rows[0]!["Артикул"]).toBe("A-1")
    expect(rows[0]!["Ширина"]).toBe("45")

    const parsed = parseProductRow(rows[0]!, 2)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.widthMm).toBe(45)
  })

  test("числовой штрих-код не портится молча", async () => {
    // Excel хранит 4600000000017 числом и отображает научной нотацией
    const buf = await makeXlsx([
      ["sku", "name", "barcode"],
      ["B-1", "X", 4600000000017],
    ])
    const rows = await readXlsxRecords(buf)
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

  test("пустой файл -> пустой список", async () => {
    const buf = await makeXlsx([["sku", "name"]])
    expect(await readXlsxRecords(buf)).toHaveLength(0)
  })
})
