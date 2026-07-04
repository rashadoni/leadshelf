import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const deleteSchema = z.object({ expectedRevision: z.string().datetime() })

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string; zoneId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { planogramId, versionId, zoneId } = await params

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const version = await workerDb.planogramVersion.findFirst({
    where: { id: versionId, planogramId, planogram: { organizationId: session.org } },
    select: { id: true, state: true, updatedAt: true },
  })
  if (!version) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (version.state !== "DRAFT") return NextResponse.json({ error: "invalid_state" }, { status: 409 })
  if (version.updatedAt.getTime() !== new Date(parsed.data.expectedRevision).getTime()) {
    return NextResponse.json({ error: "version_conflict" }, { status: 409 })
  }

  const zone = await workerDb.planogramZone.findFirst({
    where: { id: zoneId, planogramVersionId: version.id },
    select: { id: true },
  })
  if (!zone) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const result = await workerDb.$transaction(async (tx) => {
    await tx.planogramPlacement.updateMany({ where: { zoneId: zone.id }, data: { zoneId: null } })
    await tx.planogramZone.delete({ where: { id: zone.id } })
    const updated = await tx.planogramVersion.update({
      where: { id: version.id },
      data: { updatedAt: new Date() },
      select: { updatedAt: true },
    })
    return { revision: updated.updatedAt.toISOString() }
  })

  return NextResponse.json(result)
}
