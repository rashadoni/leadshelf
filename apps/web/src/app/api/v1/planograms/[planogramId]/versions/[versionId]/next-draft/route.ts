import { NextResponse, type NextRequest } from "next/server"
import { createNextDraft } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse, PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { planogramId, versionId } = await params

  try {
    const result = await createNextDraft(workerDb, session.org, {
      planogramId,
      sourceVersionId: versionId,
      authorId: session.sub,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}
