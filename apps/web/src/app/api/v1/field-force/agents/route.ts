import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { dateFilterForDay, visitDateWhere } from "@/server/field-force/dates"
import { canAdminFieldForce, canReadFieldForce, isLimitedFieldForceRole } from "@/server/field-force/permissions"
import { shapeFieldForceAgent } from "@/server/field-force/agents"
import { shapeFieldForceSettings } from "@/server/field-force/settings"

export const runtime = "nodejs"

const bodySchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") || "100", 10)))
  const now = new Date()
  const todayFilter = dateFilterForDay(now)
  const todayVisitWhere = visitDateWhere(todayFilter)
  const isLimitedRole = isLimitedFieldForceRole(session.role)

  const [settingsRow, agents] = await Promise.all([
    workerDb.fieldForceSetting.findUnique({
      where: { organizationId: session.org },
    }),
    workerDb.fieldAgent.findMany({
    where: {
      organizationId: session.org,
      ...(isLimitedRole ? { userId: session.sub } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      team: { select: { id: true, name: true } },
      locations: { orderBy: { recordedAt: "desc" }, take: 1 },
      routes: {
        where: { isActive: true },
        include: {
          stops: {
            orderBy: { sortOrder: "asc" },
            include: {
              visits: { where: todayVisitWhere, select: { id: true, status: true } },
            },
          },
        },
      },
      visits: {
        where: todayVisitWhere,
        include: { store: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
    orderBy: { user: { name: "asc" } },
    take: limit,
    }),
  ])
  const settings = shapeFieldForceSettings(settingsRow)

  const [teams, existingAgents] = canAdminFieldForce(session.role)
    ? await Promise.all([
        workerDb.team.findMany({
          where: { organizationId: session.org },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        workerDb.fieldAgent.findMany({
          where: { organizationId: session.org },
          select: { userId: true },
        }),
      ])
    : [[], []]

  const assignedUserIds = existingAgents.map((agent) => agent.userId)
  const users = canAdminFieldForce(session.role)
    ? await workerDb.user.findMany({
        where: {
          organizationId: session.org,
          isActive: true,
          ...(assignedUserIds.length ? { id: { notIn: assignedUserIds } } : {}),
        },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, name: true, email: true, employeeCode: true, role: true },
      })
    : []

  return NextResponse.json({
    success: true,
    data: {
      agents: agents.map((agent) => shapeFieldForceAgent(agent, now, settings)),
      teams,
      users,
      total: agents.length,
      generatedAt: now,
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

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
