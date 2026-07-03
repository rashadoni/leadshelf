import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { saveVersion, EquipmentRepoError } from "@leadshelf/db"
import { validateShelfList } from "@leadshelf/core"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const saveSchema = z.object({
  expectedVersionNumber: z.number().int().min(1),
  widthMm: z.number().int().min(1).max(10000),
  heightMm: z.number().int().min(1).max(10000),
  depthMm: z.number().int().min(1).max(5000),
  shelves: z
    .array(
      z.object({
        shelfIndex: z.number().int().min(0),
        yMm: z.number().int().min(0),
        thicknessMm: z.number().int().min(1),
        depthMm: z.number().int().min(1),
        maxLoadKg: z.number().int().positive().nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
})

// Save-семантика (docs/15): draft обновляется на месте, frozen -> новая версия.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { expectedVersionNumber, shelves, ...geometry } = parsed.data

  const shelfIssues = validateShelfList(shelves, geometry)
  if (shelfIssues.length > 0) {
    return NextResponse.json({ error: "invalid_shelves", issues: shelfIssues }, { status: 422 })
  }

  try {
    const saved = await saveVersion(workerDb, session.org, id, {
      expectedVersionNumber,
      geometry,
      shelves,
    })
    return NextResponse.json(saved)
  } catch (e) {
    if (e instanceof EquipmentRepoError) {
      const status =
        e.code === "not_found" ? 404 : e.code === "version_conflict" ? 409 : 422
      return NextResponse.json({ error: e.code, message: e.message }, { status })
    }
    throw e
  }
}
