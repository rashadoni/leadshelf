import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { iteratePlanogramProductRows } from "@/server/analytics/planogram-products"
import { createPlanogramProductsXmlStream } from "@/server/analytics/planogram-products-export"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  // Full export reads bounded DB pages lazily and starts responding before the
  // complete tenant dataset is materialized in process memory.
  const rows = iteratePlanogramProductRows(workerDb, session.org)
  return new NextResponse(createPlanogramProductsXmlStream(rows), {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="planogram-products.xls"`,
      "Cache-Control": "no-store",
    },
  })
}
