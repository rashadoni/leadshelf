import { describe, expect, it } from "vitest"
import type { FieldRoutePoint, FieldWeekRoute } from "./contracts"
import { resolveFieldRouteFlow } from "./route-flow"

function point(id: string, orderIndex: number, effectiveStatus: FieldRoutePoint["effectiveStatus"]): FieldRoutePoint {
  return {
    id,
    customerId: "customer-" + id,
    contactId: null,
    orderIndex,
    status: effectiveStatus,
    effectiveStatus,
    plannedTime: null,
    visitedAt: null,
    notes: null,
    customer: {
      id: "customer-" + id,
      name: "Customer " + id,
      code: null,
      objectType: "CLINIC",
      category: "A",
      address: null,
      city: "Baku",
      phone: null,
      latitude: 40.4,
      longitude: 49.8,
    },
    contact: null,
    visitPolicy: null,
  }
}

function route(points: FieldRoutePoint[]): Pick<FieldWeekRoute, "id" | "points"> {
  return { id: "route-1", points }
}

describe("field route flow", () => {
  it("orders the roadmap and recommends the first pending point", () => {
    const flow = resolveFieldRouteFlow(route([
      point("two", 2, "PENDING"),
      point("one", 1, "VISITED"),
      point("three", 3, "MISSED"),
    ]), null)

    expect(flow.steps.map((step) => [step.point.id, step.state])).toEqual([
      ["one", "completed"],
      ["two", "next"],
      ["three", "missed"],
    ])
    expect(flow.primaryPoint?.id).toBe("two")
    expect(flow).toMatchObject({ completed: 1, missed: 1, remaining: 1, progressPercent: 33 })
  })

  it("keeps an active visit as the only primary action", () => {
    const flow = resolveFieldRouteFlow(route([
      point("one", 1, "VISITED"),
      point("two", 2, "PENDING"),
      point("three", 3, "PENDING"),
    ]), { routeId: "route-1", routePointId: "two", status: "CHECKED_IN" })

    expect(flow.activePoint?.id).toBe("two")
    expect(flow.nextPoint?.id).toBe("three")
    expect(flow.primaryPoint?.id).toBe("two")
    expect(flow.steps.map((step) => step.state)).toEqual(["completed", "active", "next"])
  })

  it("does not treat an active visit from another route as this route's progress", () => {
    const flow = resolveFieldRouteFlow(route([point("one", 1, "PENDING")]), {
      routeId: "route-other",
      routePointId: "one",
      status: "CHECKED_IN",
    })

    expect(flow.activePoint).toBeNull()
    expect(flow.primaryPoint?.id).toBe("one")
  })
})
