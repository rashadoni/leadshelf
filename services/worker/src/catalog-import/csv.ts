import { parse } from "csv-parse/sync"
import iconv from "iconv-lite"
import type { RawCsvRow } from "@leadshelf/core"

export interface CsvReadOptions {
  /** "utf-8" (default) | "windows-1251" — 1С часто выгружает 1251. */
  encoding?: "utf-8" | "windows-1251"
  /** Автоопределение "," vs ";" если не задан. */
  delimiter?: "," | ";"
}

/** Buffer CSV -> строки с сырыми заголовками. BOM срезается парсером. */
export function readCsvRecords(buffer: Buffer, opts: CsvReadOptions = {}): RawCsvRow[] {
  const text =
    opts.encoding === "windows-1251"
      ? iconv.decode(buffer, "win1251")
      : buffer.toString("utf-8")

  const firstLine = text.slice(0, text.indexOf("\n") + 1 || text.length)
  const delimiter =
    opts.delimiter ??
    ((firstLine.split(";").length > firstLine.split(",").length ? ";" : ",") as "," | ";")

  return parse(text, {
    columns: true,
    bom: true,
    delimiter,
    skip_empty_lines: true,
    trim: false, // трим делают парсеры core (cleanCell)
    relax_column_count: true,
  }) as RawCsvRow[]
}
