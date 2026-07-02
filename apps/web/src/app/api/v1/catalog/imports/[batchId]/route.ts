import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const { batchId } = await params

  const batch = await tenantDb(session.org).importBatch.findFirst({
    where: { id: batchId },
  })
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 })

  return NextResponse.json({
    id: batch.id,
    entityType: batch.entityType,
    status: batch.status,
    totalRows: batch.totalRows,
    errorRows: batch.errorRows,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
  })
}
