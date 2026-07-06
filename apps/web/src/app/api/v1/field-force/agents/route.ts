import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ADMIN_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR"])
const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

const bodySchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
})

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function dateRange(value: Date) {
  const start = startOfDay(value)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

function visitDateWhere(dateFilter: { gte: Date; lt: Date }) {
  return {
    OR: [
      { createdAt: dateFilter },
      { checkInAt: dateFilter },
      { checkOutAt: dateFilter },
      { routeStop: { plannedAt: dateFilter } },
    ],
  }
}

function shapeAgent(agent: any, now: Date, offlineCutoff: Date) {
  const latestLocation = agent.locations[0] ?? null
  const routeStops = agent.routes.flatMap((route: any) => route.stops ?? [])
  const completedStops = routeStops.filter((stop: any) =>
    stop.visits?.some((visit: any) => visit.status === "COMPLETED"),
  ).length
  const routeCompletion = routeStops.length > 0 ? Math.round((completedStops / routeStops.length) * 100) : 0
  const activeVisit = agent.visits.find((visit: any) => visit.status === "IN_PROGRESS")
  const plannedLateStop = routeStops.find(
    (stop: any) =>
      stop.plannedAt &&
      stop.plannedAt < now &&
      !stop.visits?.some((visit: any) => visit.status === "COMPLETED" || visit.status === "SKIPPED"),
  )
  const isOnline = Boolean(latestLocation && latestLocation.recordedAt >= offlineCutoff && agent.user.isActive)
  const fieldStatus = !isOnline
    ? "OFFLINE"
    : activeVisit
      ? "CHECKED_IN"
      : plannedLateStop
        ? "LATE"
        : "ON_ROAD"
  const completedVisitsToday = agent.visits.filter((visit: any) => visit.status === "COMPLETED").length

  return {
    id: agent.id,
    agentId: agent.id,
    userId: agent.userId,
    name: agent.user.name,
    email: agent.user.email,
    role: agent.user.role,
    status: agent.user.isActive ? "ACTIVE" : "INACTIVE",
    phone: agent.phone,
    employeeCode: agent.employeeCode,
    teamId: agent.teamId,
    team: agent.team ? { id: agent.team.id, name: agent.team.name } : null,
    isOnline,
    fieldStatus,
    routeCompletion,
    visitsToday: agent.visits.length,
    completedVisitsToday,
    activeRoutes: agent.routes.length,
    routeStopsToday: routeStops.length,
    lastCustomer: agent.visits[0]?.store?.name ?? null,
    lastSeenAt: latestLocation?.recordedAt ?? null,
    latitude: latestLocation?.latitude ?? null,
    longitude: latestLocation?.longitude ?? null,
    accuracy: latestLocation?.accuracyM ?? null,
  }
}

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") || "100", 10)))
  const now = new Date()
  const { start: today, end: tomorrow } = dateRange(now)
  const todayFilter = { gte: today, lt: tomorrow }
  const todayVisitWhere = visitDateWhere(todayFilter)
  const offlineCutoff = new Date(now.getTime() - 45 * 60 * 1000)
  const isLimitedRole = session.role === "MERCHANDISER" || session.role === "STORE_STAFF"

  const agents = await workerDb.fieldAgent.findMany({
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
  })

  const [teams, existingAgents] = FIELD_FORCE_ADMIN_ROLES.has(session.role)
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
  const users = FIELD_FORCE_ADMIN_ROLES.has(session.role)
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
      agents: agents.map((agent) => shapeAgent(agent, now, offlineCutoff)),
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
