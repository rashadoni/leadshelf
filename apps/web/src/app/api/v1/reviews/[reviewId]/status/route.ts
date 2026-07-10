import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { decideHumanReview, ReviewRepoError } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const REVIEW_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "SUPERVISOR"])

const bodySchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!REVIEW_ROLES.has(session.role)) return forbidden()

  const [{ reviewId }, body] = await Promise.all([params, req.json().catch(() => null)])
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const updated = await decideHumanReview(workerDb, session.org, {
      reviewId,
      status: parsed.data.status,
      note: parsed.data.note,
      reviewedById: session.sub,
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ReviewRepoError) {
      return NextResponse.json({ error: error.code }, { status: 404 })
    }
    throw error
  }
}
