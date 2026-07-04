import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
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

  const review = await workerDb.humanReview.findFirst({
    where: { id: reviewId, organizationId: session.org },
    select: { id: true },
  })
  if (!review) return NextResponse.json({ error: "review_not_found" }, { status: 404 })

  const updated = await workerDb.humanReview.update({
    where: { id: review.id },
    data: {
      status: parsed.data.status,
      note: parsed.data.note,
      reviewedById: session.sub,
      reviewedAt: new Date(),
    },
    select: { id: true, status: true },
  })

  return NextResponse.json(updated)
}
