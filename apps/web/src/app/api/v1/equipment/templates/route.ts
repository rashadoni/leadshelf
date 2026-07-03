import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createTemplateWithVersion, EquipmentRepoError } from "@leadshelf/db"
import { validateShelfList } from "@leadshelf/core"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const shelfSchema = z.object({
  shelfIndex: z.number().int().min(0),
  yMm: z.number().int().min(0),
  thicknessMm: z.number().int().min(1),
  depthMm: z.number().int().min(1),
  maxLoadKg: z.number().int().positive().nullable().optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  typeId: z.string().min(1),
  widthMm: z.number().int().min(1).max(10000),
  heightMm: z.number().int().min(1).max(10000),
  depthMm: z.number().int().min(1).max(5000),
  shelves: z.array(shelfSchema).max(200).default([]),
})

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const templates = await tenantDb(session.org).equipmentTemplate.findMany({
    include: {
      type: { select: { name: true, kind: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { shelves: { select: { id: true } } },
      },
    },
    orderBy: [{ name: "asc" }],
    take: 100,
  })

  return NextResponse.json({
    templates: templates.map((t) => {
      const latest = t.versions[0]
      return {
        id: t.id,
        name: t.name,
        type: t.type,
        latestVersion: latest
          ? {
              versionNumber: latest.versionNumber,
              isFrozen: latest.isFrozen,
              widthMm: latest.widthMm,
              heightMm: latest.heightMm,
              depthMm: latest.depthMm,
              shelfCount: latest.shelves.length,
            }
          : null,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { name, typeId, shelves, ...geometry } = parsed.data

  const shelfIssues = validateShelfList(shelves, geometry)
  if (shelfIssues.length > 0) {
    return NextResponse.json({ error: "invalid_shelves", issues: shelfIssues }, { status: 422 })
  }

  try {
    const created = await createTemplateWithVersion(workerDb, session.org, {
      name,
      typeId,
      geometry,
      shelves,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof EquipmentRepoError) {
      return NextResponse.json({ error: e.code }, { status: e.code === "not_found" ? 404 : 409 })
    }
    throw e
  }
}
