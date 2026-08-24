import type {
  FieldRoutePoint,
  FieldWeekDay,
  FieldWeekRoute,
  FieldWeekVisit,
  FieldWorkdayAction,
} from "./contracts"
import { resolveFieldRouteFlow } from "./route-flow"

type TodayRoute = Pick<FieldWeekRoute, "id" | "points">
type TodayDay = Pick<FieldWeekDay, "date" | "routePlanningAllowed"> & { routes: TodayRoute[] }

export type FieldTodayPrimaryAction =
  | { kind: "CONTINUE_VISIT"; href: string }
  | { kind: "START_WORKDAY" | "RESUME_WORKDAY"; href: "/(app)/workday" }
  | { kind: "OPEN_NEXT_ROUTE"; href: string; nextStopName: string | null }
  | { kind: "CREATE_ROUTE"; href: string }
  | { kind: "OPEN_WEEK"; href: "/(app)/(tabs)/week" }

function routeForPrimaryPoint(
  routes: TodayRoute[],
  activeVisit: Pick<FieldWeekVisit, "routeId" | "routePointId" | "status"> | null,
): TodayRoute | null {
  const activeRoute = activeVisit?.routeId
    ? routes.find((route) => route.id === activeVisit.routeId) ?? null
    : null
  return activeRoute ?? routes.find((route) => resolveFieldRouteFlow(route, activeVisit).primaryPoint !== null) ?? null
}

function pointName(point: Pick<FieldRoutePoint, "customer" | "contact"> | null): string | null {
  return point?.contact?.displayName ?? point?.customer.name ?? null
}

/**
 * Keeps the Home tab to one honest next step.  It intentionally does not
 * perform a workday transition itself: the workday screen remains the place
 * where an employee sees the attendance/privacy policy before starting.
 */
export function resolveFieldTodayPrimaryAction({
  isField,
  activeVisit,
  today,
  canCreateOwnDraft,
  availableWorkdayActions,
}: {
  isField: boolean
  activeVisit: Pick<FieldWeekVisit, "id" | "routeId" | "routePointId" | "status"> | null
  today: TodayDay | null
  canCreateOwnDraft: boolean
  availableWorkdayActions: FieldWorkdayAction[] | null | undefined
}): FieldTodayPrimaryAction {
  // An unfinished visit is always recovered first, rather than starting a
  // second workflow which could leave the previous check-in stranded.
  if (activeVisit?.status === "CHECKED_IN") {
    return { kind: "CONTINUE_VISIT", href: `/(app)/field-visits/${activeVisit.id}` }
  }

  const workdayActions = availableWorkdayActions ?? ["START"]
  if (isField && workdayActions.includes("START")) {
    return { kind: "START_WORKDAY", href: "/(app)/workday" }
  }
  if (isField && workdayActions.includes("RESUME")) {
    return { kind: "RESUME_WORKDAY", href: "/(app)/workday" }
  }

  const route = routeForPrimaryPoint(today?.routes ?? [], activeVisit)
  if (route) {
    const flow = resolveFieldRouteFlow(route, activeVisit)
    return {
      kind: "OPEN_NEXT_ROUTE",
      href: `/(app)/routes/${route.id}`,
      nextStopName: pointName(flow.primaryPoint),
    }
  }

  if (isField && today?.routePlanningAllowed && canCreateOwnDraft) {
    return {
      kind: "CREATE_ROUTE",
      href: `/(app)/routes/new?date=${encodeURIComponent(today.date)}`,
    }
  }

  return { kind: "OPEN_WEEK", href: "/(app)/(tabs)/week" }
}
