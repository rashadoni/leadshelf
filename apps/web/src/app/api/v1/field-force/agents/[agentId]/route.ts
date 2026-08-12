import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { canAdminFieldForce } from "@/server/field-force/permissions"
import { hashPassword } from "@/server/auth/password"

export const runtime = "nodejs"

const patchSchema = z.object({
  teamId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  pin: z.string().regex(/^\d{4,12}$/).optional(),
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
  const data = parsed.data

  const [agent, team] = await Promise.all([
    workerDb.fieldAgent.findFirst({
      where: { id: agentId, organizationId: session.org },
      select: { id: true, userId: true },
    }),
    data.teamId
      ? workerDb.team.findFirst({
          where: { id: data.teamId, organizationId: session.org },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (data.teamId && !team) return NextResponse.json({ error: "team_not_found" }, { status: 404 })

  const passwordHash = data.pin ? await hashPassword(data.pin) : null
  const updated = await workerDb.$transaction(async (tx) => {
    const result = await tx.fieldAgent.update({
      where: { id: agent.id },
      data: {
        ...(data.teamId !== undefined ? { teamId: team?.id ?? null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      },
      select: { id: true },
    })
    if (passwordHash) {
      await tx.user.update({
        where: { id: agent.userId },
        data: { passwordHash },
      })
      await tx.authSession.updateMany({
        where: {
          organizationId: session.org,
          userId: agent.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: "field agent PIN reset",
        },
      })
    }
    await tx.auditLog.create({
      data: {
        organizationId: session.org,
        userId: session.sub,
        action: passwordHash ? "field_agent.update_and_reset_pin" : "field_agent.update",
        entityType: "FieldAgent",
        entityId: agent.id,
        payload: { targetUserId: agent.userId, pinReset: Boolean(passwordHash) },
      },
    })
    return result
  })

  return NextResponse.json({ success: true, data: updated })
}
