import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { validateFloorPlanLayout } from "@leadshelf/core"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const equipmentSchema = z.object({
  equipmentVersionId: z.string().min(1),
  planogramId: z.string().min(1).nullable().optional(),
  label: z.string().trim().max(120).nullable().optional(),
  xMm: z.number().int().min(0),
  yMm: z.number().int().min(0),
  rotationDeg: z.number().int().min(-360).max(360).refine((value) => value % 90 === 0, {
    message: "rotationDeg must be a multiple of 90",
  }).default(0),
  isLocked: z.boolean().default(false),
})

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    storeId: z.string().min(1).nullable().optional(),
    formatId: z.string().min(1).nullable().optional(),
    widthMm: z.number().int().min(100).max(200000),
    depthMm: z.number().int().min(100).max(200000),
    isPublished: z.boolean().default(true),
    equipment: z.array(equipmentSchema).max(300).default([]),
  })
  .refine((value) => Boolean(value.storeId) !== Boolean(value.formatId), {
    message: "storeId xor formatId required",
    path: ["storeId"],
  })

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  const [store, format, equipmentVersions, planograms] = await Promise.all([
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
        id: { in: data.equipment.map((item) => item.planogramId).filter((id): id is string => Boolean(id)) },
      },
      select: { id: true },
    }),
  ])
  if (data.storeId && !store) return NextResponse.json({ error: "store_not_found" }, { status: 404 })
  if (data.formatId && !format) return NextResponse.json({ error: "format_not_found" }, { status: 404 })
  const equipmentVersionIds = new Set(equipmentVersions.map((version) => version.id))
  if (equipmentVersionIds.size !== new Set(data.equipment.map((item) => item.equipmentVersionId)).size) {
    return NextResponse.json({ error: "equipment_not_found" }, { status: 404 })
  }
  const planogramIds = new Set(planograms.map((planogram) => planogram.id))
  if (planogramIds.size !== new Set(data.equipment.map((item) => item.planogramId).filter(Boolean)).size) {
    return NextResponse.json({ error: "planogram_not_found" }, { status: 404 })
  }
  const layoutIssues = validateFloorPlanLayout(
    { widthMm: data.widthMm, depthMm: data.depthMm },
    data.equipment.map((item) => {
      const version = equipmentVersions.find((candidate) => candidate.id === item.equipmentVersionId)!
      return { ...item, widthMm: version.widthMm, depthMm: version.depthMm }
    }),
  )
  const layoutIssue = layoutIssues[0]
  if (layoutIssue) {
    return NextResponse.json({
      error: layoutIssue.type === "outside_bounds" ? "equipment_out_of_bounds" : "equipment_overlap",
      index: layoutIssue.index,
      conflictingIndex: layoutIssue.conflictingIndex,
      label: data.equipment[layoutIssue.index]?.label,
    }, { status: 422 })
  }

  const floorPlan = await workerDb.$transaction(async (tx) => {
    const created = await tx.floorPlan.create({
      data: {
        organizationId: session.org,
        name: data.name,
        storeId: data.storeId ?? null,
        formatId: data.formatId ?? null,
      },
    })
    const version = await tx.floorPlanVersion.create({
      data: {
        floorPlanId: created.id,
        versionNumber: 1,
        widthMm: data.widthMm,
        depthMm: data.depthMm,
        isPublished: data.isPublished,
        publishedAt: data.isPublished ? new Date() : null,
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
    return { id: created.id, versionId: version.id }
  })
  return NextResponse.json({ floorPlan }, { status: 201 })
}
