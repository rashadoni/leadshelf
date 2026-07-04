import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const { batchId } = await params

  const batch = await workerDb.importBatch.findFirst({
    where: { id: batchId, organizationId: session.org },
    include: { queueJob: true },
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
    queueJob: batch.queueJob
      ? {
          id: batch.queueJob.id,
          status: batch.queueJob.status,
          attempts: batch.queueJob.attempts,
          error: batch.queueJob.error,
          createdAt: batch.queueJob.createdAt.toISOString(),
          startedAt: batch.queueJob.startedAt?.toISOString() ?? null,
          finishedAt: batch.queueJob.finishedAt?.toISOString() ?? null,
        }
      : null,
  })
}
