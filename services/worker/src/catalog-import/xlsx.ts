import * as XLSX from "xlsx"
import type { RawCsvRow } from "@leadshelf/core"

// XLSX -> строки с сырыми заголовками (первый лист).
// raw:false — значения приходят строками в отображаемом формате: числа,
// которые Excel показывает научной нотацией (штрих-коды), придут как
// "4.6E+12" и попадут под excel_mangled-детектор парсера. Это осознанно:
// испорченное отображение = испорченные данные, чинится форматом колонки.
export function readXlsxRecords(buffer: Buffer): RawCsvRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]!
  return XLSX.utils.sheet_to_json<RawCsvRow>(sheet, { raw: false, defval: "" })
}
