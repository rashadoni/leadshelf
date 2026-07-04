import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { addPlacement } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse, PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const rotationSchema = z.number().int().min(-270).max(270).refine((value) => value % 90 === 0)
const stackModeSchema = z.enum(["NONE", "ON_TOP", "LYING"])

const addSchema = z.object({
  expectedRevision: z.string().datetime(),
  shelfId: z.string().min(1),
  productId: z.string().min(1),
  xMm: z.number().int().min(0).optional(),
  facingsX: z.number().int().min(1).max(500).default(1),
  facingsY: z.number().int().min(1).max(100).default(1),
  facingsZ: z.number().int().min(1).max(100).default(1),
  rotationX: rotationSchema.default(0),
  rotationY: rotationSchema.default(0),
  rotationZ: rotationSchema.default(0),
  stackMode: stackModeSchema.default("NONE"),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { versionId } = await params

  const body = await req.json().catch(() => null)
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await addPlacement(workerDb, session.org, {
      planogramVersionId: versionId,
      ...parsed.data,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}
