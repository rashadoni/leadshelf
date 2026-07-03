import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { transitionTaskStatus } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { planogramErrorResponse } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

// Офисные роли; SUPERVISOR тоже управляет задачами
const TASK_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER", "SUPERVISOR"])

const statusEnum = z.enum(["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED", "COMPLETED", "EXPIRED", "EMPTY"])
const bodySchema = z.object({ expectedStatus: statusEnum, toStatus: statusEnum })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!TASK_ROLES.has(session.role)) return forbidden()
  const { taskId } = await params

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  try {
    const result = await transitionTaskStatus(workerDb, session.org, {
      taskId,
      expectedStatus: parsed.data.expectedStatus,
      toStatus: parsed.data.toStatus,
      byUserId: session.sub,
    })
    return NextResponse.json(result)
  } catch (e) {
    const res = planogramErrorResponse(e)
    if (res) return res
    throw e
  }
}
