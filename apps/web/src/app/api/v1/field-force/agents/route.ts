import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ADMIN_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR"])

const bodySchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ADMIN_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const [user, team] = await Promise.all([
    workerDb.user.findFirst({
      where: { id: parsed.data.userId, organizationId: session.org, isActive: true },
      select: { id: true, employeeCode: true, fieldAgent: { select: { id: true } } },
    }),
    parsed.data.teamId
      ? workerDb.team.findFirst({
          where: { id: parsed.data.teamId, organizationId: session.org },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 })
  if (user.fieldAgent) return NextResponse.json({ error: "agent_already_exists" }, { status: 409 })
  if (parsed.data.teamId && !team) return NextResponse.json({ error: "team_not_found" }, { status: 404 })

  const agent = await workerDb.fieldAgent.create({
    data: {
      organizationId: session.org,
      userId: user.id,
      teamId: team?.id,
      phone: parsed.data.phone || null,
      employeeCode: user.employeeCode,
    },
    select: { id: true },
  })

  return NextResponse.json(agent, { status: 201 })
}
