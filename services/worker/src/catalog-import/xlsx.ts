import ExcelJS from "exceljs"
import type { RawCsvRow } from "@leadshelf/core"
import { Readable } from "node:stream"

// XLSX -> строки с сырыми заголовками (первый лист).
// Cell.text сохраняет отображаемое значение. Это важно для штрих-кодов:
// scientific notation не должна молча превращаться в другой идентификатор.
export async function readXlsxRecords(buffer: Buffer): Promise<RawCsvRow[]> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "cache",
    entries: "ignore",
  })
  for await (const sheet of workbook) {
    const rows: RawCsvRow[] = []
    let headers: string[] | null = null
    for await (const row of sheet) {
      if (!headers) {
        headers = Array.from({ length: row.cellCount }, (_, index) =>
          row.getCell(index + 1).text.trim(),
        )
        continue
      }
      const record: RawCsvRow = {}
      let hasValue = false
      for (let index = 0; index < headers.length; index++) {
        const header = headers[index]
        if (!header) continue
        const value = row.getCell(index + 1).text
        record[header] = value
        if (value !== "") hasValue = true
      }
      if (hasValue) rows.push(record)
    }
    return rows
  }
  return []
}
