import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { forbidden, requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const equipmentSchema = z.object({
  equipmentVersionId: z.string().min(1),
  planogramId: z.string().min(1).nullable().optional(),
  label: z.string().trim().max(120).nullable().optional(),
  xMm: z.number().int().min(0),
  yMm: z.number().int().min(0),
  rotationDeg: z.number().int().min(-360).max(360).default(0),
  isLocked: z.boolean().default(false),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  storeId: z.string().min(1).nullable().optional(),
  formatId: z.string().min(1).nullable().optional(),
  widthMm: z.number().int().min(100).max(200000),
  depthMm: z.number().int().min(100).max(200000),
  equipment: z.array(equipmentSchema).max(300).default([]),
}).refine((value) => Boolean(value.storeId) !== Boolean(value.formatId), {
  message: "storeId xor formatId required",
  path: ["storeId"],
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  const [floorPlan, store, format, equipmentVersions, planograms] = await Promise.all([
    workerDb.floorPlan.findFirst({
      where: { id, organizationId: session.org },
      select: {
        id: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { versionNumber: true },
        },
      },
    }),
    data.storeId
      ? workerDb.store.findFirst({ where: { id: data.storeId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
    data.formatId
      ? workerDb.storeFormat.findFirst({ where: { id: data.formatId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
    workerDb.equipmentVersion.findMany({
      where: {
        id: { in: data.equipment.map((item) => item.equipmentVersionId) },
        template: { organizationId: session.org },
      },
      select: { id: true, widthMm: true, depthMm: true },
    }),
    workerDb.planogram.findMany({
      where: {
        organizationId: session.org,
        id: { in: data.equipment.map((item) => item.planogramId).filter((item): item is string => Boolean(item)) },
      },
      select: { id: true },
    }),
  ])
  if (!floorPlan) return NextResponse.json({ error: "floor_plan_not_found" }, { status: 404 })
  if (data.storeId && !store) return NextResponse.json({ error: "store_not_found" }, { status: 404 })
  if (data.formatId && !format) return NextResponse.json({ error: "format_not_found" }, { status: 404 })

  const requestedEquipmentIds = new Set(data.equipment.map((item) => item.equipmentVersionId))
  if (equipmentVersions.length !== requestedEquipmentIds.size) {
    return NextResponse.json({ error: "equipment_not_found" }, { status: 404 })
  }
  const requestedPlanogramIds = new Set(data.equipment.map((item) => item.planogramId).filter(Boolean))
  if (planograms.length !== requestedPlanogramIds.size) {
    return NextResponse.json({ error: "planogram_not_found" }, { status: 404 })
  }
  for (const item of data.equipment) {
    const version = equipmentVersions.find((candidate) => candidate.id === item.equipmentVersionId)!
    if (item.xMm + version.widthMm > data.widthMm || item.yMm + version.depthMm > data.depthMm) {
      return NextResponse.json({ error: "equipment_out_of_bounds", label: item.label }, { status: 422 })
    }
  }

  const updated = await workerDb.$transaction(async (tx) => {
    await tx.floorPlan.update({
      where: { id: floorPlan.id },
      data: {
        name: data.name,
        storeId: data.storeId ?? null,
        formatId: data.formatId ?? null,
      },
    })
    const version = await tx.floorPlanVersion.create({
      data: {
        floorPlanId: floorPlan.id,
        versionNumber: (floorPlan.versions[0]?.versionNumber ?? 0) + 1,
        widthMm: data.widthMm,
        depthMm: data.depthMm,
        isPublished: true,
        publishedAt: new Date(),
      },
    })
    if (data.equipment.length > 0) {
      await tx.floorPlanEquipment.createMany({
        data: data.equipment.map((item) => ({
          floorPlanVersionId: version.id,
          equipmentVersionId: item.equipmentVersionId,
          planogramId: item.planogramId ?? null,
          label: item.label ?? null,
          xMm: item.xMm,
          yMm: item.yMm,
          rotationDeg: item.rotationDeg,
          isLocked: item.isLocked,
        })),
      })
    }
    return { id: floorPlan.id, versionId: version.id, versionNumber: version.versionNumber }
  })

  return NextResponse.json({ floorPlan: updated })
}
