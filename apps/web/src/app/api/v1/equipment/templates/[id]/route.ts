import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const { id } = await params

  const template = await tenantDb(session.org).equipmentTemplate.findFirst({
    where: { id },
    include: {
      type: { select: { id: true, name: true, kind: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { shelves: { orderBy: { shelfIndex: "asc" } } },
      },
    },
  })
  if (!template) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ template })
}
