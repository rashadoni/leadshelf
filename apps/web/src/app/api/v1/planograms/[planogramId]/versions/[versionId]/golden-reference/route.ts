import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const bodySchema = z.object({
  photoSubmissionId: z.string().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const [{ planogramId, versionId }, body] = await Promise.all([
    params,
    req.json().catch(() => null),
  ])
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const [version, photo] = await Promise.all([
    workerDb.planogramVersion.findFirst({
      where: { id: versionId, planogramId, planogram: { organizationId: session.org } },
      select: { id: true },
    }),
    workerDb.photoSubmission.findFirst({
      where: {
        id: parsed.data.photoSubmissionId,
        organizationId: session.org,
        task: { planogramVersionId: versionId },
      },
      select: { id: true, url: true },
    }),
  ])
  if (!version) return NextResponse.json({ error: "version_not_found" }, { status: 404 })
  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 })

  const goldenReference = await workerDb.goldenReference.create({
    data: {
      organizationId: session.org,
      planogramVersionId: version.id,
      photoSubmissionId: photo.id,
      imageUrl: photo.url,
      createdById: session.sub,
    },
  })

  return NextResponse.json({
    id: goldenReference.id,
    imageUrl: goldenReference.imageUrl,
    status: goldenReference.status,
    createdAt: goldenReference.createdAt.toISOString(),
  })
}
