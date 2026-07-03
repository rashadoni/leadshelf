import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function DELETE(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string; slotId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const { planogramId, versionId, referenceId, slotId } = await params
  const slot = await workerDb.goldenReferenceSlot.findFirst({
    where: {
      id: slotId,
      goldenReferenceId: referenceId,
      goldenReference: {
        organizationId: session.org,
        planogramVersionId: versionId,
        planogramVersion: { planogramId, planogram: { organizationId: session.org } },
      },
    },
    select: { id: true },
  })

  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 })

  await workerDb.goldenReferenceSlot.delete({ where: { id: slot.id } })
  return NextResponse.json({ ok: true })
}
