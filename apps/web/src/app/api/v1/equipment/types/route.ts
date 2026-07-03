import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const types = await tenantDb(session.org).equipmentType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true },
  })
  return NextResponse.json({ types })
}
