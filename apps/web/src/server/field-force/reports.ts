import { scoreFieldForceAgent, type FieldAgentStatus } from "./agents"

export function percent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

export interface FieldForceReportRoute {
  id: string
  name: string
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  totalPoints: number
  visitedPoints: number
  agent?: { id: string; name: string } | null
}

export interface FieldForceReportAgent {
  id: string
  name: string
  isOnline: boolean
  fieldStatus: FieldAgentStatus
  routeCompletion: number
  visitsToday: number
  completedVisitsToday: number
  team?: { id: string; name: string } | null
}

export function summarizeFieldForceReport(routes: FieldForceReportRoute[], agents: FieldForceReportAgent[]) {
  const totalPoints = routes.reduce((sum, route) => sum + route.totalPoints, 0)
  const visitedPoints = routes.reduce((sum, route) => sum + route.visitedPoints, 0)

  return {
    totalRoutes: routes.length,
    inProgressRoutes: routes.filter((route) => route.status === "IN_PROGRESS").length,
    completedRoutes: routes.filter((route) => route.status === "COMPLETED").length,
    plannedRoutes: routes.filter((route) => route.status === "PLANNED").length,
    cancelledRoutes: routes.filter((route) => route.status === "CANCELLED").length,
    totalPoints,
    visitedPoints,
    completion: percent(visitedPoints, totalPoints),
    onlineAgents: agents.filter((agent) => agent.isOnline).length,
    lateAgents: agents.filter((agent) => agent.fieldStatus === "LATE").length,
  }
}

export function shapeLeaderboard(agents: FieldForceReportAgent[]) {
  return [...agents]
    .map((agent) => ({
      ...agent,
      score: scoreFieldForceAgent(agent),
    }))
    .sort((a, b) => b.score - a.score)
}
