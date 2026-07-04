import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { copyTemplate, EquipmentRepoError } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])
const copySchema = z.object({ name: z.string().trim().min(1).max(120).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params
  const parsed = copySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const copied = await copyTemplate(workerDb, session.org, id, parsed.data)
    return NextResponse.json(copied, { status: 201 })
  } catch (error) {
    if (error instanceof EquipmentRepoError) {
      return NextResponse.json({ error: error.code }, { status: error.code === "not_found" ? 404 : 409 })
    }
    throw error
  }
}
