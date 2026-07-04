import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])
const copySchema = z.object({
  storeId: z.string().min(1),
  name: z.string().trim().min(1).max(160).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params
  const parsed = copySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const [source, store] = await Promise.all([
    workerDb.floorPlan.findFirst({
      where: { id, organizationId: session.org, formatId: { not: null } },
      include: {
        format: { select: { name: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { equipment: true },
        },
      },
    }),
    workerDb.store.findFirst({
      where: { id: parsed.data.storeId, organizationId: session.org, isActive: true },
      select: { id: true, name: true, code: true },
    }),
  ])
  if (!source || !source.versions[0]) return NextResponse.json({ error: "source_not_found" }, { status: 404 })
  if (!store) return NextResponse.json({ error: "store_not_found" }, { status: 404 })

  const result = await workerDb.$transaction(async (tx) => {
    const floorPlan = await tx.floorPlan.create({
      data: {
        organizationId: session.org,
        name: parsed.data.name ?? `${source.name} - ${store.code ?? store.name}`,
        storeId: store.id,
      },
    })
    const sourceVersion = source.versions[0]!
    const version = await tx.floorPlanVersion.create({
      data: {
        floorPlanId: floorPlan.id,
        versionNumber: 1,
        widthMm: sourceVersion.widthMm,
        depthMm: sourceVersion.depthMm,
        isPublished: sourceVersion.isPublished,
        publishedAt: sourceVersion.isPublished ? new Date() : null,
      },
    })
    if (sourceVersion.equipment.length > 0) {
      await tx.floorPlanEquipment.createMany({
        data: sourceVersion.equipment.map((item) => ({
          floorPlanVersionId: version.id,
          equipmentVersionId: item.equipmentVersionId,
          planogramId: item.planogramId,
          label: item.label,
          xMm: item.xMm,
          yMm: item.yMm,
          rotationDeg: item.rotationDeg,
          isLocked: item.isLocked,
        })),
      })
    }
    return { id: floorPlan.id, versionId: version.id }
  })
  return NextResponse.json({ floorPlan: result }, { status: 201 })
}
