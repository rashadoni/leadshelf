import type { FieldRoutePoint, FieldWeekData, FieldWeekRoute } from "./contracts"

export function addOptimisticRoute(
  week: FieldWeekData,
  input: {
    id: string
    agentId: string
    date: string
    name: string | null
    notes: string | null
    points: FieldRoutePoint[]
  },
): FieldWeekData {
  const route: FieldWeekRoute = {
    id: input.id,
    name: input.name,
    date: input.date,
    persistedStatus: "DRAFT",
    effectiveStatus: "DRAFT",
    agentId: input.agentId,
    totalPoints: input.points.length,
    visitedPoints: 0,
    startedAt: null,
    completedAt: null,
    notes: input.notes,
    assignmentRole: "PRIMARY",
    canExecute: false,
    canEdit: true,
    canPublish: false,
    syncState: "PENDING",
    points: input.points,
  }
  let added = false
  const days = week.days.map((day) => {
    if (day.date !== input.date || day.routes.some((item) => item.id === input.id)) return day
    added = true
    return { ...day, routes: [...day.routes, route] }
  })
  if (!added) return week
  return {
    ...week,
    days,
    summary: {
      ...week.summary,
      routes: week.summary.routes + 1,
      draftRoutes: week.summary.draftRoutes + 1,
    },
  }
}

export function updateOptimisticRoute(
  week: FieldWeekData,
  routeId: string,
  input: { name: string | null; notes: string | null; points: FieldRoutePoint[] },
): FieldWeekData {
  let changed = false
  const days = week.days.map((day) => {
    let dayChanged = false
    const routes = day.routes.map((route) => {
      if (route.id !== routeId) return route
      changed = true
      dayChanged = true
      return {
        ...route,
        name: input.name,
        notes: input.notes,
        totalPoints: input.points.length,
        points: input.points,
        syncState: "PENDING" as const,
      }
    })
    return dayChanged ? { ...day, routes } : day
  })
  return changed ? { ...week, days } : week
}
