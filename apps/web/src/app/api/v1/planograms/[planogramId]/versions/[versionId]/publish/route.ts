import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { publishPlanogramVersion } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse, PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const publishSchema = z.object({
  expectedRevision: z.string().datetime(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("FORMAT"), formatId: z.string().min(1) }),
    z.object({
      type: z.literal("STORES"),
      storeIds: z.array(z.string().min(1)).min(1).max(500),
    }),
  ]),
  activeFrom: z.string().datetime().optional(),
  activeTo: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  changeNote: z.string().max(1000).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { planogramId, versionId } = await params

  const body = await req.json().catch(() => null)
  const parsed = publishSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await publishPlanogramVersion(workerDb, session.org, {
      planogramId,
      versionId,
      expectedRevision: parsed.data.expectedRevision,
      target: parsed.data.target,
      activeFrom: parsed.data.activeFrom ? new Date(parsed.data.activeFrom) : undefined,
      activeTo: parsed.data.activeTo ? new Date(parsed.data.activeTo) : null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      publishedById: session.sub,
      changeNote: parsed.data.changeNote,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}
