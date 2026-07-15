import type {
  FieldRoutePoint,
  FieldVisitPolicy,
  FieldWeekData,
  FieldWeekVisit,
} from "./contracts"

export type OptimisticVisitStart = {
  visitId: string
  routeId: string
  routePoint: FieldRoutePoint
  routeDate: string
  checkInAt: string
}

function subjectKey(customerId: string, contactId: string | null): string {
  return contactId ? `contact:${contactId}` : `customer:${customerId}`
}

function recalculateCoverage(week: FieldWeekData): FieldWeekData["summary"]["coverage"] {
  const planned = new Set<string>()
  const covered = new Set<string>()
  for (const day of week.days) {
    for (const route of day.routes) {
      if (route.persistedStatus === "DRAFT" || route.persistedStatus === "CANCELLED") continue
      for (const point of route.points) {
        const key = subjectKey(point.customerId, point.contactId)
        planned.add(key)
        if (point.effectiveStatus === "VISITED") covered.add(key)
      }
    }
  }
  const coveredCustomers = [...covered].filter((key) => planned.has(key)).length
  return {
    plannedCustomers: planned.size,
    coveredCustomers,
    percentage: planned.size === 0 ? 0 : Math.round((coveredCustomers / planned.size) * 1_000) / 10,
  }
}

export function startOptimisticFieldVisit(
  week: FieldWeekData,
  input: OptimisticVisitStart,
): FieldWeekData {
  if (week.days.some((day) => day.visits.items.some((visit) => visit.id === input.visitId))) return week
  let changed = false
  const visit: FieldWeekVisit = {
    id: input.visitId,
    customerId: input.routePoint.customerId,
    contactId: input.routePoint.contactId,
    routeId: input.routeId,
    routePointId: input.routePoint.id,
    status: "CHECKED_IN",
    checkInAt: input.checkInAt,
    checkOutAt: null,
    outcome: null,
    potential: null,
    notes: null,
    resultNotes: null,
    syncState: "PENDING",
    customer: {
      id: input.routePoint.customer.id,
      name: input.routePoint.customer.name,
      objectType: input.routePoint.customer.objectType,
    },
    contact: input.routePoint.contact ? {
      id: input.routePoint.contact.id,
      displayName: input.routePoint.contact.displayName,
      type: input.routePoint.contact.type,
    } : null,
  }
  const days = week.days.map((day) => {
    const isVisitDay = day.date === input.routeDate
    let dayChanged = false
    const routes = day.routes.map((route) => {
      if (route.id !== input.routeId) return route
      changed = true
      dayChanged = true
      return {
        ...route,
        effectiveStatus: "IN_PROGRESS" as const,
        startedAt: route.startedAt ?? input.checkInAt,
      }
    })
    if (!isVisitDay && !dayChanged) return day
    if (isVisitDay) {
      changed = true
      dayChanged = true
    }
    return {
      ...day,
      routes,
      visits: isVisitDay
        ? { ...day.visits, total: day.visits.total + 1, items: [...day.visits.items, visit] }
        : day.visits,
    }
  })
  return changed ? {
    ...week,
    days,
    summary: { ...week.summary, visits: week.summary.visits + 1 },
  } : week
}

export function completeOptimisticFieldVisit(
  week: FieldWeekData,
  input: {
    visitId: string
    checkOutAt: string
    outcome: FieldWeekVisit["outcome"]
    potential: FieldWeekVisit["potential"]
    resultNotes: string | null
  },
): FieldWeekData {
  let completedVisit = false
  let visitedStop = false
  const days = week.days.map((day) => {
    let dayChanged = false
    const visits = day.visits.items.map((visit) => {
      if (visit.id !== input.visitId || visit.status === "CHECKED_OUT") return visit
      completedVisit = true
      dayChanged = true
      return {
        ...visit,
        status: "CHECKED_OUT",
        checkOutAt: input.checkOutAt,
        outcome: input.outcome,
        potential: input.potential,
        resultNotes: input.resultNotes,
        syncState: "PENDING" as const,
      }
    })
    const targetVisit = visits.find((visit) => visit.id === input.visitId)
    const routes = day.routes.map((route) => {
      if (!targetVisit || route.id !== targetVisit.routeId) return route
      let routeChanged = false
      const points = route.points.map((point) => {
        if (point.id !== targetVisit.routePointId || point.effectiveStatus === "VISITED") return point
        routeChanged = true
        visitedStop = true
        return { ...point, status: "VISITED", effectiveStatus: "VISITED" as const, visitedAt: input.checkOutAt }
      })
      if (!routeChanged) return route
      dayChanged = true
      const visitedPoints = points.filter((point) => point.effectiveStatus === "VISITED").length
      const complete = visitedPoints >= route.totalPoints
      return {
        ...route,
        points,
        visitedPoints,
        persistedStatus: complete ? "COMPLETED" as const : "IN_PROGRESS" as const,
        effectiveStatus: complete ? "COMPLETED" as const : "IN_PROGRESS" as const,
        completedAt: complete ? input.checkOutAt : route.completedAt,
      }
    })
    return dayChanged ? {
      ...day,
      routes,
      visits: {
        ...day.visits,
        completed: day.visits.completed + (completedVisit ? 1 : 0),
        items: visits,
      },
    } : day
  })
  if (!completedVisit) return week
  const next = {
    ...week,
    days,
    summary: {
      ...week.summary,
      visitsCompleted: week.summary.visitsCompleted + 1,
      visitedStops: week.summary.visitedStops + (visitedStop ? 1 : 0),
    },
  }
  return { ...next, summary: { ...next.summary, coverage: recalculateCoverage(next) } }
}

export function setOptimisticFieldVisitSyncState(
  week: FieldWeekData,
  visitId: string,
  syncState: FieldWeekVisit["syncState"],
): FieldWeekData {
  let changed = false
  const days = week.days.map((day) => {
    let dayChanged = false
    const items = day.visits.items.map((visit) => {
      if (visit.id !== visitId) return visit
      changed = true
      dayChanged = true
      return { ...visit, syncState }
    })
    return dayChanged ? { ...day, visits: { ...day.visits, items } } : day
  })
  return changed ? { ...week, days } : week
}

export function findFieldVisit(week: FieldWeekData | null, visitId: string): FieldWeekVisit | null {
  return week?.days.flatMap((day) => day.visits.items).find((visit) => visit.id === visitId) ?? null
}

export function routePointVisitPolicy(
  week: FieldWeekData | null,
  routePointId: string | null,
): FieldVisitPolicy | null {
  if (!routePointId) return null
  return week?.days
    .flatMap((day) => day.routes)
    .flatMap((route) => route.points)
    .find((point) => point.id === routePointId)?.visitPolicy ?? null
}
