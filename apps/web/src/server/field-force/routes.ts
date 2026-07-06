export type FieldForceRouteStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export type FieldForcePointStatus = "VISITED" | "SKIPPED" | "PENDING"

interface FieldForceVisit {
  status: "COMPLETED" | "SKIPPED" | "IN_PROGRESS" | string
  checkInAt?: Date | string | null
  checkOutAt?: Date | string | null
}

interface FieldForceRouteStop {
  id: string
  storeId: string
  sortOrder: number
  plannedAt?: Date | string | null
  visits?: FieldForceVisit[]
  store: {
    id: string
    name: string
    code?: string | null
    address?: string | null
    latitude?: number | null
    longitude?: number | null
  }
}

interface FieldForceRouteRecord {
  id: string
  name: string
  agentId?: string | null
  createdAt: Date | string
  isActive: boolean
  agent?: { id: string; user: { name: string } } | null
  stops: FieldForceRouteStop[]
}

export function plannedAtFor(date: string | null | undefined, index: number) {
  return date ? new Date(`${date}T09:${String(index).padStart(2, "0")}:00.000Z`) : null
}

export function routeStopsHaveVisits(stops: Array<{ visits?: unknown[] | null }>) {
  return stops.some((stop) => (stop.visits?.length ?? 0) > 0)
}

export function shapeFieldForceRoute(route: FieldForceRouteRecord) {
  const points = [...route.stops]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stop, index) => {
      const completedVisit = stop.visits?.find((visit) => visit.status === "COMPLETED")
      const skippedVisit = stop.visits?.find((visit) => visit.status === "SKIPPED")
      const inProgressVisit = stop.visits?.find((visit) => visit.status === "IN_PROGRESS")
      const status: FieldForcePointStatus = completedVisit ? "VISITED" : skippedVisit ? "SKIPPED" : "PENDING"
      return {
        id: stop.id,
        customerId: stop.storeId,
        orderIndex: index,
        status,
        plannedTime: stop.plannedAt ?? null,
        visitedAt: completedVisit?.checkOutAt ?? inProgressVisit?.checkInAt ?? null,
        customer: {
          id: stop.store.id,
          name: stop.store.name,
          code: stop.store.code,
          address: stop.store.address,
          latitude: stop.store.latitude,
          longitude: stop.store.longitude,
        },
      }
    })
  const totalPoints = points.length
  const visitedPoints = points.filter((point) => point.status === "VISITED").length
  const hasInProgress = route.stops.some((stop) => stop.visits?.some((visit) => visit.status === "IN_PROGRESS"))
  const status: FieldForceRouteStatus = !route.isActive
    ? "CANCELLED"
    : totalPoints > 0 && visitedPoints === totalPoints
      ? "COMPLETED"
      : hasInProgress
        ? "IN_PROGRESS"
        : "PLANNED"
  const plannedDates = route.stops.map((stop) => stop.plannedAt).filter(Boolean)
  const date = plannedDates[0] ?? route.createdAt
  const routeVisits = route.stops.flatMap((stop) => stop.visits ?? [])

  return {
    id: route.id,
    name: route.name,
    agentId: route.agentId ?? null,
    date,
    status,
    totalPoints,
    visitedPoints,
    startedAt: routeVisits.find((visit) => visit.checkInAt)?.checkInAt ?? null,
    completedAt: status === "COMPLETED" ? routeVisits.at(-1)?.checkOutAt ?? null : null,
    notes: null,
    agent: route.agent ? { id: route.agent.id, name: route.agent.user.name } : null,
    points,
  }
}
