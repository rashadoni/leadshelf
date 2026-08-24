import { describe, expect, it } from "vitest"
import type { FieldRoutePoint, FieldWeekRoute } from "./contracts"
import { resolveFieldTodayPrimaryAction } from "./today-primary-action"

function point(id: string, orderIndex: number, status: FieldRoutePoint["effectiveStatus"]): FieldRoutePoint {
  return {
    id,
    customerId: `customer-${id}`,
    contactId: null,
    orderIndex,
    status,
    effectiveStatus: status,
    plannedTime: null,
    visitedAt: null,
    notes: null,
    customer: {
      id: `customer-${id}`,
      name: `Customer ${id}`,
      code: null,
      objectType: "CLINIC",
      category: "A",
      address: null,
      city: "Baku",
      phone: null,
      latitude: null,
      longitude: null,
    },
    contact: null,
    visitPolicy: null,
  }
}

function route(points: FieldRoutePoint[]): Pick<FieldWeekRoute, "id" | "points"> {
  return { id: "route-1", points }
}

describe("field Today primary action", () => {
  it("recovers an unfinished visit before offering a new workday", () => {
    expect(resolveFieldTodayPrimaryAction({
      isField: true,
      activeVisit: { id: "visit-1", routeId: "route-1", routePointId: "point-1", status: "CHECKED_IN" },
      today: { date: "2026-08-24", routePlanningAllowed: true, routes: [route([point("point-1", 1, "PENDING")])] },
      canCreateOwnDraft: true,
      availableWorkdayActions: ["START"],
    })).toEqual({ kind: "CONTINUE_VISIT", href: "/(app)/field-visits/visit-1" })
  })

  it("takes a field agent to the policy-aware workday screen before a route", () => {
    expect(resolveFieldTodayPrimaryAction({
      isField: true,
      activeVisit: null,
      today: { date: "2026-08-24", routePlanningAllowed: true, routes: [route([point("point-1", 1, "PENDING")])] },
      canCreateOwnDraft: true,
      availableWorkdayActions: ["START"],
    })).toEqual({ kind: "START_WORKDAY", href: "/(app)/workday" })
  })

  it("returns a paused employee to resume before a next stop", () => {
    expect(resolveFieldTodayPrimaryAction({
      isField: true,
      activeVisit: null,
      today: { date: "2026-08-24", routePlanningAllowed: true, routes: [route([point("point-1", 1, "PENDING")])] },
      canCreateOwnDraft: true,
      availableWorkdayActions: ["RESUME", "FINISH"],
    })).toEqual({ kind: "RESUME_WORKDAY", href: "/(app)/workday" })
  })

  it("does not label the week as an existing route when planning is unavailable", () => {
    expect(resolveFieldTodayPrimaryAction({
      isField: true,
      activeVisit: null,
      today: { date: "2026-08-24", routePlanningAllowed: false, routes: [] },
      canCreateOwnDraft: true,
      availableWorkdayActions: [],
    })).toEqual({ kind: "OPEN_WEEK", href: "/(app)/(tabs)/week" })
  })

  it("opens the three-step route flow only with the server grant and a plannable day", () => {
    expect(resolveFieldTodayPrimaryAction({
      isField: true,
      activeVisit: null,
      today: { date: "2026-08-24", routePlanningAllowed: true, routes: [] },
      canCreateOwnDraft: true,
      availableWorkdayActions: [],
    })).toEqual({ kind: "CREATE_ROUTE", href: "/(app)/routes/new?date=2026-08-24" })
  })
})
