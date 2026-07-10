import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requestCaptureRetake, CaptureRepoError } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

// Офис просит переснять конкретный шаг сценария (docs/23 web review backlog).
const RETAKE_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "SUPERVISOR"])

const schema = z.object({
  stepId: z.string().min(1).max(64),
  stepKind: z.string().max(64).nullable().optional(),
  note: z.string().trim().max(500).optional(),
  reviewId: z.string().min(1).nullable().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!RETAKE_ROLES.has(session.role)) return forbidden()
  const { taskId } = await params

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  try {
    const request = await requestCaptureRetake(workerDb, session.org, {
      taskId,
      stepId: parsed.data.stepId,
      stepKind: parsed.data.stepKind ?? null,
      note: parsed.data.note ?? null,
      requestedById: session.sub,
      reviewId: parsed.data.reviewId ?? null,
    })
    return NextResponse.json({ ok: true, retakeId: request.id })
  } catch (error) {
    if (error instanceof CaptureRepoError) {
      return NextResponse.json({ error: error.code }, { status: 404 })
    }
    throw error
  }
}
