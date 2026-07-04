import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const createSchema = z.object({
  expectedRevision: z.string().datetime(),
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  xMm: z.number().int().min(0),
  yMm: z.number().int().min(0),
  widthMm: z.number().int().min(1),
  heightMm: z.number().int().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { planogramId, versionId } = await params

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const data = parsed.data

  const version = await workerDb.planogramVersion.findFirst({
    where: { id: versionId, planogramId, planogram: { organizationId: session.org } },
    include: {
      equipment: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        include: { equipmentVersion: { select: { widthMm: true, heightMm: true } } },
      },
    },
  })
  if (!version) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (version.state !== "DRAFT") return NextResponse.json({ error: "invalid_state" }, { status: 409 })
  if (version.updatedAt.getTime() !== new Date(data.expectedRevision).getTime()) {
    return NextResponse.json({ error: "version_conflict" }, { status: 409 })
  }
  const equipment = version.equipment[0]
  if (!equipment) return NextResponse.json({ error: "no_equipment" }, { status: 409 })
  if (
    data.xMm + data.widthMm > equipment.equipmentVersion.widthMm ||
    data.yMm + data.heightMm > equipment.equipmentVersion.heightMm
  ) {
    return NextResponse.json({ error: "zone_out_of_bounds" }, { status: 422 })
  }

  const result = await workerDb.$transaction(async (tx) => {
    const zone = await tx.planogramZone.create({
      data: {
        planogramVersionId: version.id,
        planogramEquipmentId: equipment.id,
        name: data.name,
        color: data.color ?? "#f59e0b",
        xMm: data.xMm,
        yMm: data.yMm,
        widthMm: data.widthMm,
        heightMm: data.heightMm,
      },
    })
    const updated = await tx.planogramVersion.update({
      where: { id: version.id },
      data: { updatedAt: new Date() },
      select: { updatedAt: true },
    })
    return { zone, revision: updated.updatedAt.toISOString() }
  })

  return NextResponse.json({
    id: result.zone.id,
    name: result.zone.name,
    color: result.zone.color,
    xMm: result.zone.xMm,
    yMm: result.zone.yMm,
    widthMm: result.zone.widthMm,
    heightMm: result.zone.heightMm,
    revision: result.revision,
  }, { status: 201 })
}
