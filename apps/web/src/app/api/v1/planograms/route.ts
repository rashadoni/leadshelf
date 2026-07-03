import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createPlanogramFromTemplate } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse, PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { tenantDb, workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  categoryId: z.string().optional(),
  equipmentTemplateId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const planograms = await tenantDb(session.org).planogram.findMany({
    include: {
      category: { select: { name: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          state: true,
          updatedAt: true,
          _count: { select: { placements: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })

  return NextResponse.json({
    planograms: planograms.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category?.name ?? null,
      latestVersion: p.versions[0]
        ? {
            id: p.versions[0].id,
            versionNumber: p.versions[0].versionNumber,
            state: p.versions[0].state,
            placements: p.versions[0]._count.placements,
          }
        : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const created = await createPlanogramFromTemplate(workerDb, session.org, {
      ...parsed.data,
      authorId: session.sub,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    return planogramErrorResponse(e) ?? Promise.reject(e)
  }
}
