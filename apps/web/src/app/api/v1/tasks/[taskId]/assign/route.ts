import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"
import { ASSIGNABLE_ROLES } from "@/server/tasks/assignable-roles"

export const runtime = "nodejs"

const ASSIGN_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER", "SUPERVISOR"])

const schema = z.object({ assigneeId: z.string().min(1).nullable() })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!ASSIGN_ROLES.has(session.role)) return forbidden()
  const { taskId } = await params

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const db = tenantDb(session.org)
  if (parsed.data.assigneeId) {
    // Исполнителем может быть только полевая роль (docs/26 §6): офисного
    // пользователя нельзя повесить как исполнителя задачи выкладки.
    const assignee = await db.user.findFirst({
      where: { id: parsed.data.assigneeId, isActive: true, role: { in: [...ASSIGNABLE_ROLES] } },
      select: { id: true },
    })
    if (!assignee) return NextResponse.json({ error: "assignee_not_assignable" }, { status: 422 })
  }

  const updated = await db.task.updateMany({
    where: { id: taskId },
    data: { assigneeId: parsed.data.assigneeId },
  })
  if (updated.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
