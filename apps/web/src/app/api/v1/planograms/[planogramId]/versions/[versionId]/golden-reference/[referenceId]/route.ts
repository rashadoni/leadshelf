import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const statusSchema = z.enum(["ACTIVE", "ARCHIVED"])
const patchSchema = z.object({
  status: statusSchema.optional(),
})

async function findReference(
  organizationId: string,
  planogramId: string,
  versionId: string,
  referenceId: string,
) {
  return workerDb.goldenReference.findFirst({
    where: {
      id: referenceId,
      organizationId,
      planogramVersionId: versionId,
      planogramVersion: { planogramId, planogram: { organizationId } },
    },
    select: { id: true },
  })
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const [{ planogramId, versionId, referenceId }, body] = await Promise.all([
    params,
    req.json().catch(() => null),
  ])
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const reference = await findReference(session.org, planogramId, versionId, referenceId)
  if (!reference) return NextResponse.json({ error: "reference_not_found" }, { status: 404 })

  const updated = await workerDb.goldenReference.update({
    where: { id: reference.id },
    data: parsed.data,
    select: { id: true, status: true, updatedAt: true },
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
  })
}

export async function DELETE(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const { planogramId, versionId, referenceId } = await params
  const reference = await findReference(session.org, planogramId, versionId, referenceId)
  if (!reference) return NextResponse.json({ error: "reference_not_found" }, { status: 404 })

  await workerDb.goldenReference.delete({ where: { id: reference.id } })
  return NextResponse.json({ ok: true })
}
