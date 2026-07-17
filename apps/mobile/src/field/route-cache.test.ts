import { describe, expect, it } from "vitest"
import type { FieldRoutePoint, FieldWeekData } from "./contracts"
import { addOptimisticRoute, setOptimisticRouteSyncState, updateOptimisticRoute } from "./route-cache"

const point: FieldRoutePoint = {
  id: "local-point-1",
  customerId: "clinic-1",
  contactId: null,
  orderIndex: 0,
  status: "PENDING",
  effectiveStatus: "PENDING",
  plannedTime: null,
  visitedAt: null,
  notes: null,
  customer: {
    id: "clinic-1", name: "Clinic", code: null, objectType: "CLINIC", category: "A",
    address: null, city: "Baku", phone: null, latitude: null, longitude: null,
  },
  contact: null,
  visitPolicy: null,
}

const week = {
  weekStart: "2026-07-13",
  days: [{ date: "2026-07-15", routes: [] }],
  summary: { routes: 0, draftRoutes: 0 },
} as unknown as FieldWeekData

describe("optimistic field route cache", () => {
  it("adds a queued draft to the selected day", () => {
    const next = addOptimisticRoute(week, {
      id: "local-route-1",
      agentId: "agent-1",
      date: "2026-07-15",
      name: "North",
      notes: null,
      points: [point],
    })
    expect(next.days[0]?.routes[0]).toMatchObject({ id: "local-route-1", syncState: "PENDING" })
    expect(next.summary).toMatchObject({ routes: 1, draftRoutes: 1 })
  })

  it("updates the same local draft instead of creating a second card", () => {
    const created = addOptimisticRoute(week, {
      id: "local-route-1",
      agentId: "agent-1",
      date: "2026-07-15",
      name: "North",
      notes: null,
      points: [point],
    })
    const next = updateOptimisticRoute(created, "local-route-1", {
      name: "North updated",
      notes: "offline",
      points: [{ ...point, plannedTime: "2026-07-15T05:00:00.000Z" }],
    })
    expect(next.days[0]?.routes).toHaveLength(1)
    expect(next.days[0]?.routes[0]).toMatchObject({ name: "North updated", syncState: "PENDING" })
    expect(setOptimisticRouteSyncState(next, "local-route-1", "CONFLICT").days[0]?.routes[0]).toMatchObject({ syncState: "CONFLICT" })
  })
})
