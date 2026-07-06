import { NextResponse, type NextRequest } from "next/server"
import { workerDb } from "@/server/db/client"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { shapeFieldForceAgent } from "@/server/field-force/agents"
import { dateFilterForDay, visitDateWhere } from "@/server/field-force/dates"
import { canReadFieldForce, isLimitedFieldForceRole } from "@/server/field-force/permissions"
import { shapeLeaderboard } from "@/server/field-force/reports"
import { shapeFieldForceSettings } from "@/server/field-force/settings"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10)))
  const now = new Date()
  const todayFilter = dateFilterForDay(searchParams.get("date") ? new Date(searchParams.get("date")!) : now)
  const todayVisitWhere = visitDateWhere(todayFilter)

  const [settingsRow, agents] = await Promise.all([
    workerDb.fieldForceSetting.findUnique({
      where: { organizationId: session.org },
    }),
    workerDb.fieldAgent.findMany({
      where: {
        organizationId: session.org,
        ...(isLimitedFieldForceRole(session.role) ? { userId: session.sub } : {}),
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
  const shapedAgents = agents.map((agent) => shapeFieldForceAgent(agent, now, settings))
  const leaderboard = shapeLeaderboard(shapedAgents).slice(0, limit)

  return NextResponse.json({
    success: true,
    data: { leaderboard, total: leaderboard.length, generatedAt: now },
  })
}
