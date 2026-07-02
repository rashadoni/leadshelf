import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

// UI ручного ввода/коррекции размеров — обязательная часть MVP (docs/03).
const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const dimensionsSchema = z
  .object({
    widthMm: z.number().int().positive().nullable().optional(),
    heightMm: z.number().int().positive().nullable().optional(),
    depthMm: z.number().int().positive().nullable().optional(),
    weightG: z.number().int().positive().nullable().optional(),
  })
  .strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = dimensionsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  // updateMany: tenant client скоупит where по организации сам
  const result = await tenantDb(session.org).product.updateMany({
    where: { id },
    data: parsed.data,
  })
  if (result.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
