import type { FieldRoutePoint, FieldWeekRoute, FieldWeekVisit } from "./contracts"

export type FieldRouteStepState = "completed" | "active" | "next" | "upcoming" | "missed"

export type FieldRouteStep = {
  point: FieldRoutePoint
  position: number
  state: FieldRouteStepState
}

export type FieldRouteFlow = {
  steps: FieldRouteStep[]
  activePoint: FieldRoutePoint | null
  nextPoint: FieldRoutePoint | null
  primaryPoint: FieldRoutePoint | null
  completed: number
  missed: number
  remaining: number
  progressPercent: number
}

function orderedPoints(points: FieldRoutePoint[]): FieldRoutePoint[] {
  return points
    .map((point, sourceIndex) => ({ point, sourceIndex }))
    .sort((left, right) => (
      left.point.orderIndex - right.point.orderIndex || left.sourceIndex - right.sourceIndex
    ))
    .map(({ point }) => point)
}

/**
 * Gives every route screen one consistent, non-blocking sequence model.
 * A later pending point stays available, but only one point is presented as
 * the next recommended action. That preserves field flexibility without
 * making an agent guess the intended order.
 */
export function resolveFieldRouteFlow(
  route: Pick<FieldWeekRoute, "id" | "points">,
  activeVisit: Pick<FieldWeekVisit, "routeId" | "routePointId" | "status"> | null,
): FieldRouteFlow {
  const points = orderedPoints(route.points)
  const activePointId = activeVisit?.routeId === route.id && activeVisit.status === "CHECKED_IN"
    ? activeVisit.routePointId
    : null
  const activePoint = activePointId
    ? points.find((point) => point.id === activePointId) ?? null
    : null
  const nextPoint = points.find((point) => (
    point.effectiveStatus === "PENDING" && point.id !== activePointId
  )) ?? null
  const completed = points.filter((point) => point.effectiveStatus === "VISITED").length
  const missed = points.filter((point) => point.effectiveStatus === "MISSED").length
  const remaining = points.filter((point) => point.effectiveStatus === "PENDING").length

  return {
    steps: points.map((point, index) => {
      let state: FieldRouteStepState
      if (point.effectiveStatus === "VISITED") state = "completed"
      else if (point.effectiveStatus === "MISSED") state = "missed"
      else if (point.id === activePointId) state = "active"
      else if (point.id === nextPoint?.id) state = "next"
      else state = "upcoming"
      return { point, position: index + 1, state }
    }),
    activePoint,
    nextPoint,
    primaryPoint: activePoint ?? nextPoint,
    completed,
    missed,
    remaining,
    progressPercent: points.length === 0 ? 0 : Math.round((completed / points.length) * 100),
  }
}
