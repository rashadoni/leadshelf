import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { formatMeters, getPlanogramProductRows } from "@/server/analytics/planogram-products"

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

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const rows = await getPlanogramProductRows(workerDb, session.org)
  const header = [
    "Planogram",
    "Version",
    "State",
    "SKU",
    "Product",
    "Brand",
    "Category",
    "Supplier",
    "Placements",
    "Units",
    "Linear meters",
  ]

  const body = rows
    .map((row) =>
      [
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
      ].join(""),
    )
    .map((cells) => `<Row>${cells}</Row>`)
    .join("")

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Planogram products">
  <Table>
   <Row>${header.map((h) => cell(h)).join("")}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`

  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="planogram-products.xls"`,
      "Cache-Control": "no-store",
    },
  })
}
