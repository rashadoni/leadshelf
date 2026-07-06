import { NextResponse, type NextRequest } from "next/server"
import { workerDb } from "@/server/db/client"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { dateFilterForDay, visitDateWhere } from "@/server/field-force/dates"
import { canReadFieldForce, isLimitedFieldForceRole } from "@/server/field-force/permissions"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10)))
  const day = searchParams.get("date") ? new Date(searchParams.get("date")!) : new Date()
  const todayFilter = dateFilterForDay(day)
  const scopedAgentWhere = isLimitedFieldForceRole(session.role)
    ? { agent: { userId: session.sub } }
    : {}

  const [visits, locations] = await Promise.all([
    workerDb.visit.findMany({
      where: {
        organizationId: session.org,
        ...visitDateWhere(todayFilter),
        ...scopedAgentWhere,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        agent: { select: { id: true, user: { select: { name: true } } } },
        store: { select: { id: true, name: true } },
        routeStop: { select: { plannedAt: true } },
      },
    }),
    workerDb.agentLocation.findMany({
      where: {
        recordedAt: todayFilter,
        agent: {
          organizationId: session.org,
          ...(isLimitedFieldForceRole(session.role) ? { userId: session.sub } : {}),
        },
      },
      orderBy: { recordedAt: "desc" },
      take: Math.min(25, limit),
      include: {
        agent: { select: { user: { select: { name: true } } } },
      },
    }),
  ])

  const events = [
    ...visits.map((visit) => ({
      id: `visit-${visit.id}`,
      type: visit.status === "IN_PROGRESS" ? "CHECK_IN" : visit.status === "COMPLETED" ? "CHECK_OUT" : visit.status,
      agent: visit.agent.user.name,
      customer: visit.store.name,
      time: visit.checkOutAt ?? visit.checkInAt ?? visit.routeStop?.plannedAt ?? visit.createdAt,
    })),
    ...locations.map((location) => ({
      id: `location-${location.id}`,
      type: "LOCATION",
      agent: location.agent.user.name,
      customer: "GPS",
      time: location.recordedAt,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, limit)

  return NextResponse.json({
    success: true,
    data: { events, total: events.length, generatedAt: new Date() },
  })
}
