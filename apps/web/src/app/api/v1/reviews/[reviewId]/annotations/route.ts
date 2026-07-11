import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { saveManualShelfAnalysis, ShelfAnalysisRepoError } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const REVIEW_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "SUPERVISOR"])

const bboxSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100),
  heightPct: z.number().positive().max(100),
}).refine((bbox) => bbox.xPct + bbox.widthPct <= 100 && bbox.yPct + bbox.heightPct <= 100, {
  message: "bbox_out_of_bounds",
})

const bodySchema = z.object({
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    placementId: z.string().trim().min(1).nullable().optional(),
    productId: z.string().trim().min(1).nullable().optional(),
    facings: z.number().int().min(1).max(999),
    bbox: bboxSchema,
  })).max(200),
})

export async function PUT(
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
    const saved = await saveManualShelfAnalysis(workerDb, session.org, {
      reviewId,
      reviewedById: session.sub,
      annotations: parsed.data.annotations,
    })
    return NextResponse.json({ runId: saved.run.id, result: saved.result })
  } catch (error) {
    if (error instanceof ShelfAnalysisRepoError) {
      return NextResponse.json({ error: error.code }, { status: 404 })
    }
    throw error
  }
}
