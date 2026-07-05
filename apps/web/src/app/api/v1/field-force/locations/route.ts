import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

const bodySchema = z.object({
  agentId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(5000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
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

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""

  if (agentId) {
    const agent = await workerDb.fieldAgent.findFirst({
      where: { id: agentId, organizationId: session.org },
      select: { id: true, userId: true },
    })
    if (!agent) return NextResponse.json({ success: false, error: "agent_not_found" }, { status: 404 })
    if ((session.role === "MERCHANDISER" || session.role === "STORE_STAFF") && agent.userId !== session.sub) {
      return forbidden()
    }

    const locations = await workerDb.agentLocation.findMany({
      where: { agentId },
      orderBy: { recordedAt: "desc" },
      take: 200,
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracyM: true,
        recordedAt: true,
      },
    })
    return NextResponse.json({
      success: true,
      data: {
        locations: locations.map((location) => ({
          ...location,
          accuracy: location.accuracyM,
        })),
      },
    })
  }

  const now = new Date()
  const { start: today, end: tomorrow } = dateRange(now)
  const offlineCutoff = new Date(now.getTime() - 45 * 60 * 1000)
  const todayFilter = { gte: today, lt: tomorrow }
  const todayVisitWhere = {
    OR: [
      { createdAt: todayFilter },
      { checkInAt: todayFilter },
      { checkOutAt: todayFilter },
      { routeStop: { plannedAt: todayFilter } },
    ],
  }

  const agents = await workerDb.fieldAgent.findMany({
    where: { organizationId: session.org },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      locations: { orderBy: { recordedAt: "desc" }, take: 5 },
      routes: {
        where: { isActive: true, stops: { some: { plannedAt: todayFilter } } },
        include: {
          stops: {
            where: { plannedAt: todayFilter },
            orderBy: { sortOrder: "asc" },
            include: {
              visits: { where: todayVisitWhere, select: { id: true, status: true } },
            },
          },
        },
      },
      visits: {
        where: todayVisitWhere,
        include: { store: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
    orderBy: { user: { name: "asc" } },
    take: 200,
  })

  const agentLocations = agents.map((agent) => {
    const loc = agent.locations[0] ?? null
    const allStops = agent.routes.flatMap((route) => route.stops)
    const totalPoints = allStops.length
    const visitedPoints = allStops.filter((stop) => stop.visits.some((visit) => visit.status === "COMPLETED")).length
    const routeCompletion = totalPoints > 0 ? Math.round((visitedPoints / totalPoints) * 100) : 0
    const activeVisit = agent.visits.find((visit) => visit.status === "IN_PROGRESS")
    const plannedLateStop = allStops.find((stop) => stop.plannedAt && stop.plannedAt < now && !stop.visits.some((visit) => visit.status === "COMPLETED"))
    const isOnline = Boolean(loc && loc.recordedAt >= offlineCutoff)
    const fieldStatus = !isOnline
      ? "OFFLINE"
      : activeVisit
        ? "CHECKED_IN"
        : plannedLateStop
          ? "LATE"
          : "ON_ROAD"

    return {
      agentId: agent.id,
      name: agent.user.name,
      isOnline,
      lastSeenAt: loc?.recordedAt ?? null,
      fieldStatus,
      routeCompletion,
      ...(loc
        ? {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracyM,
            speed: null,
            heading: null,
            battery: null,
            isMoving: false,
            recordedAt: loc.recordedAt,
          }
        : {}),
    }
  })

  const statusCounts = {
    total: agentLocations.length,
    checkedIn: agentLocations.filter((agent) => agent.fieldStatus === "CHECKED_IN").length,
    onRoad: agentLocations.filter((agent) => agent.fieldStatus === "ON_ROAD").length,
    late: agentLocations.filter((agent) => agent.fieldStatus === "LATE").length,
    offline: agentLocations.filter((agent) => agent.fieldStatus === "OFFLINE").length,
  }

  const recentVisits = await workerDb.visit.findMany({
    where: { organizationId: session.org, ...todayVisitWhere },
    take: 15,
    orderBy: { createdAt: "desc" },
    include: {
      agent: { select: { user: { select: { name: true } } } },
      store: { select: { name: true } },
      routeStop: { select: { plannedAt: true } },
    },
  })

  const liveFeed = recentVisits
    .map((visit) => ({
      id: visit.id,
      type: visit.status === "IN_PROGRESS" ? "CHECK_IN" : visit.status === "COMPLETED" ? "CHECK_OUT" : "VISIT",
      agent: visit.agent.user.name,
      customer: visit.store.name,
      time: visit.checkOutAt ?? visit.checkInAt ?? visit.routeStop?.plannedAt ?? visit.createdAt,
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 15)

  return NextResponse.json({
    success: true,
    data: { agentLocations, statusCounts, liveFeed },
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const agent = await workerDb.fieldAgent.findFirst({
    where: { id: parsed.data.agentId, organizationId: session.org },
    select: { id: true, userId: true },
  })
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (session.role === "MERCHANDISER" || session.role === "STORE_STAFF") {
    if (agent.userId !== session.sub) return forbidden()
  }

  const location = await workerDb.agentLocation.create({
    data: {
      agentId: agent.id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracyM: parsed.data.accuracyM ?? null,
      recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
    },
    select: { id: true, recordedAt: true },
  })

  return NextResponse.json(location, { status: 201 })
}
