import { formatMeters, type ProductRow } from "./planogram-products"

const HEADER = [
  "Planogram", "Version", "State", "SKU", "Product", "Brand", "Category",
  "Supplier", "Placements", "Units", "Linear meters",
]

function xml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function cell(value: string | number, type: "String" | "Number" = "String"): string {
  return `<Cell><Data ss:Type="${type}">${xml(value)}</Data></Cell>`
}

function rowXml(row: ProductRow): string {
  return `<Row>${[
    cell(row.planogramName),
    cell(row.versionNumber, "Number"),
    cell(row.state),
    cell(row.sku),
    cell(row.productName),
    cell(row.brand ?? ""),
    cell(row.category ?? ""),
    cell(row.supplier ?? ""),
    cell(row.placements, "Number"),
    cell(row.units, "Number"),
    cell(formatMeters(row.linearMm), "Number"),
  ].join("")}</Row>`
}

const PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Planogram products">
  <Table>
   <Row>${HEADER.map((heading) => cell(heading)).join("")}</Row>`

const SUFFIX = "  </Table>\n </Worksheet>\n</Workbook>"

type ProductRowSource = Iterable<ProductRow> | AsyncIterable<ProductRow>

function rowIterator(rows: ProductRowSource): AsyncIterator<ProductRow> {
  if (Symbol.asyncIterator in rows) return rows[Symbol.asyncIterator]()
  const iterator = rows[Symbol.iterator]()
  return { next: async () => iterator.next() }
}

export function createPlanogramProductsXmlStream(rows: ProductRowSource): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const iterator = rowIterator(rows)
  let prefixSent = false
  let closed = false
  return new ReadableStream({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true
        controller.enqueue(encoder.encode(PREFIX))
        return
      }
      if (closed) return
      const result = await iterator.next()
      if (!result.done) {
        controller.enqueue(encoder.encode(rowXml(result.value)))
        return
      }
      closed = true
      controller.enqueue(encoder.encode(SUFFIX))
      controller.close()
    },
  })
}
