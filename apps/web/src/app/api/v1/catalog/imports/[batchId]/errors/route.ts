import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { listImportErrorsForBatch } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const querySchema = z.object({
  severity: z.enum(["error", "warning"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const { batchId } = await params

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 })
  }

  // parent-path репозиторий: владение батчем проверяется внутри
  const result = await listImportErrorsForBatch(workerDb, session.org, batchId, parsed.data)
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 })

  return NextResponse.json({
    errors: result.errors.map((e) => ({
      id: e.id,
      rowNumber: e.rowNumber,
      field: e.field,
      reason: e.reason,
      severity: e.severity,
      suggestedFix: e.suggestedFix,
    })),
    nextCursor: result.nextCursor,
  })
}
