import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { removePlacement, updatePlacement } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse, PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const rotationSchema = z.number().int().min(-270).max(270).refine((value) => value % 90 === 0)
const stackModeSchema = z.enum(["NONE", "ON_TOP", "LYING"])

const updateSchema = z.object({
  expectedRevision: z.string().datetime(),
  shelfId: z.string().min(1).optional(),
  xMm: z.number().int().min(0).optional(),
  facingsX: z.number().int().min(1).max(500).optional(),
  facingsY: z.number().int().min(1).max(100).optional(),
  facingsZ: z.number().int().min(1).max(100).optional(),
  rotationX: rotationSchema.optional(),
  rotationY: rotationSchema.optional(),
  rotationZ: rotationSchema.optional(),
  stackMode: stackModeSchema.optional(),
})

const deleteSchema = z.object({ expectedRevision: z.string().datetime() })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ placementId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { placementId } = await params

  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const result = await updatePlacement(workerDb, session.org, { placementId, ...parsed.data })
    return NextResponse.json(result)
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ placementId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { placementId } = await params

  const body = await req.json().catch(() => null)
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const result = await removePlacement(workerDb, session.org, {
      placementId,
      expectedRevision: parsed.data.expectedRevision,
    })
    return NextResponse.json(result)
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}
