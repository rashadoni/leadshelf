import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { canAdminFieldForce } from "@/server/field-force/permissions"

export const runtime = "nodejs"

const patchSchema = z.object({
  teamId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

  const { agentId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const [agent, team] = await Promise.all([
    workerDb.fieldAgent.findFirst({
      where: { id: agentId, organizationId: session.org },
      select: { id: true },
    }),
    parsed.data.teamId
      ? workerDb.team.findFirst({
          where: { id: parsed.data.teamId, organizationId: session.org },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (parsed.data.teamId && !team) return NextResponse.json({ error: "team_not_found" }, { status: 404 })

  const updated = await workerDb.fieldAgent.update({
    where: { id: agent.id },
    data: {
      ...(parsed.data.teamId !== undefined ? { teamId: team?.id ?? null } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
    },
    select: { id: true },
  })

  return NextResponse.json({ success: true, data: updated })
}
