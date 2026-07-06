import { NextResponse, type NextRequest } from "next/server"
import { workerDb } from "@/server/db/client"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { shapeFieldForceAgent } from "@/server/field-force/agents"
import { dateFilterForDay, visitDateWhere } from "@/server/field-force/dates"
import { canReadFieldForce, isLimitedFieldForceRole } from "@/server/field-force/permissions"
import { shapeFieldForceRoute } from "@/server/field-force/routes"
import { summarizeFieldForceReport } from "@/server/field-force/reports"
import { shapeFieldForceSettings } from "@/server/field-force/settings"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const now = new Date()
  const day = searchParams.get("date") ? new Date(searchParams.get("date")!) : now
  const todayFilter = dateFilterForDay(day)
  const todayVisitWhere = visitDateWhere(todayFilter)
  const limitedAgentScope = isLimitedFieldForceRole(session.role) ? { userId: session.sub } : {}

  const [settingsRow, routes, agents] = await Promise.all([
    workerDb.fieldForceSetting.findUnique({
      where: { organizationId: session.org },
    }),
    workerDb.route.findMany({
      where: {
        organizationId: session.org,
        stops: { some: { plannedAt: todayFilter } },
        ...(isLimitedFieldForceRole(session.role) ? { agent: { userId: session.sub } } : {}),
      },
      include: {
        agent: { select: { id: true, user: { select: { name: true } } } },
        stops: {
          orderBy: { sortOrder: "asc" },
          include: {
            store: { select: { id: true, name: true, code: true, address: true, latitude: true, longitude: true } },
            visits: {
              where: todayVisitWhere,
              orderBy: { createdAt: "desc" },
              select: { id: true, status: true, checkInAt: true, checkOutAt: true, createdAt: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    workerDb.fieldAgent.findMany({
      where: {
        organizationId: session.org,
        ...limitedAgentScope,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
        team: { select: { id: true, name: true } },
        locations: { orderBy: { recordedAt: "desc" }, take: 1 },
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
          include: { store: { select: { id: true, name: true, code: true } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
      orderBy: { user: { name: "asc" } },
      take: 200,
    }),
  ])

  const settings = shapeFieldForceSettings(settingsRow)
  const shapedRoutes = routes.map(shapeFieldForceRoute)
  const shapedAgents = agents.map((agent) => shapeFieldForceAgent(agent, now, settings))
  const summary = summarizeFieldForceReport(shapedRoutes, shapedAgents)

  return NextResponse.json({
    success: true,
    data: {
      report: summary,
      routes: shapedRoutes,
      agents: shapedAgents,
      generatedAt: now,
    },
  })
}
