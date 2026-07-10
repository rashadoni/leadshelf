import { describe, expect, it } from "vitest"

import { plannedAtFor, routeStopsHaveVisits, shapeFieldForceRoute } from "./routes"

const storeA = {
  id: "store-a",
  name: "Store A",
  code: "A",
  address: "Address A",
  latitude: 40.1,
  longitude: 49.1,
}

const storeB = {
  id: "store-b",
  name: "Store B",
  code: "B",
  address: "Address B",
  latitude: 40.2,
  longitude: 49.2,
}

function route(overrides: Partial<Parameters<typeof shapeFieldForceRoute>[0]> = {}) {
  return {
    id: "route-a",
    name: "Route A",
    agentId: "agent-a",
    createdAt: new Date("2026-07-06T06:00:00.000Z"),
    isActive: true,
    agent: { id: "agent-a", user: { name: "Agent A" } },
    stops: [
      {
        id: "stop-b",
        storeId: "store-b",
        sortOrder: 2,
        plannedAt: new Date("2026-07-06T09:01:00.000Z"),
        visits: [],
        store: storeB,
      },
      {
        id: "stop-a",
        storeId: "store-a",
        sortOrder: 1,
        plannedAt: new Date("2026-07-06T09:00:00.000Z"),
        visits: [],
        store: storeA,
      },
    ],
    ...overrides,
  }
}

describe("field-force route helpers", () => {
  it("shapes stops in route order and keeps customer/store details", () => {
    const shaped = shapeFieldForceRoute(route())

    expect(shaped).toEqual(expect.objectContaining({
      id: "route-a",
      agent: { id: "agent-a", name: "Agent A" },
      status: "PLANNED",
      totalPoints: 2,
      visitedPoints: 0,
    }))
    expect(shaped.points.map((point) => [point.customerId, point.orderIndex, point.customer.name])).toEqual([
      ["store-a", 0, "Store A"],
      ["store-b", 1, "Store B"],
    ])
  })

  it("marks a route in progress when any stop has an active visit", () => {
    const checkInAt = new Date("2026-07-06T09:05:00.000Z")
    const shaped = shapeFieldForceRoute(route({
      stops: [
        {
          id: "stop-a",
          storeId: "store-a",
          sortOrder: 1,
          plannedAt: new Date("2026-07-06T09:00:00.000Z"),
          visits: [{ status: "IN_PROGRESS", checkInAt, checkOutAt: null }],
          store: storeA,
        },
      ],
    }))

    expect(shaped.status).toBe("IN_PROGRESS")
    expect(shaped.startedAt).toBe(checkInAt)
    expect(shaped.points[0]?.visitedAt).toBe(checkInAt)
  })

  it("exposes the visit trace and execution counts for route links", () => {
    const shaped = shapeFieldForceRoute(route({
      stops: [{
        id: "stop-a",
        storeId: "store-a",
        sortOrder: 1,
        plannedAt: new Date("2026-07-06T09:00:00.000Z"),
        visits: [{
          id: "visit-a",
          status: "IN_PROGRESS",
          checkInAt: new Date("2026-07-06T09:05:00.000Z"),
          _count: { orders: 2 },
        }],
        store: { ...storeA, _count: { tasks: 3 } },
      }],
    }))

    expect(shaped.points[0]).toMatchObject({
      visitId: "visit-a",
      visitStatus: "IN_PROGRESS",
      openTaskCount: 3,
      orderCount: 2,
    })
  })

  it("marks completed only when every point has a completed visit", () => {
    const firstOut = new Date("2026-07-06T09:10:00.000Z")
    const secondOut = new Date("2026-07-06T09:20:00.000Z")
    const shaped = shapeFieldForceRoute(route({
      stops: [
        {
          id: "stop-a",
          storeId: "store-a",
          sortOrder: 1,
          plannedAt: new Date("2026-07-06T09:00:00.000Z"),
          visits: [{ status: "COMPLETED", checkInAt: new Date("2026-07-06T09:00:00.000Z"), checkOutAt: firstOut }],
          store: storeA,
        },
        {
          id: "stop-b",
          storeId: "store-b",
          sortOrder: 2,
          plannedAt: new Date("2026-07-06T09:01:00.000Z"),
          visits: [{ status: "COMPLETED", checkInAt: new Date("2026-07-06T09:12:00.000Z"), checkOutAt: secondOut }],
          store: storeB,
        },
      ],
    }))

    expect(shaped.status).toBe("COMPLETED")
    expect(shaped.visitedPoints).toBe(2)
    expect(shaped.completedAt).toBe(secondOut)
  })

  it("keeps cancelled status even when route points were completed before cancellation", () => {
    const shaped = shapeFieldForceRoute(route({
      isActive: false,
      stops: [
        {
          id: "stop-a",
          storeId: "store-a",
          sortOrder: 1,
          plannedAt: new Date("2026-07-06T09:00:00.000Z"),
          visits: [{ status: "COMPLETED", checkInAt: new Date("2026-07-06T09:00:00.000Z"), checkOutAt: new Date("2026-07-06T09:10:00.000Z") }],
          store: storeA,
        },
      ],
    }))

    expect(shaped.status).toBe("CANCELLED")
    expect(shaped.completedAt).toBeNull()
  })

  it("builds deterministic planned times from a route date and stop index", () => {
    expect(plannedAtFor("2026-07-07", 0)?.toISOString()).toBe("2026-07-07T09:00:00.000Z")
    expect(plannedAtFor("2026-07-07", 7)?.toISOString()).toBe("2026-07-07T09:07:00.000Z")
    expect(plannedAtFor(null, 1)).toBeNull()
  })

  it("detects route stops that cannot be rebuilt because visits already exist", () => {
    expect(routeStopsHaveVisits([{ visits: [] }, { visits: null }])).toBe(false)
    expect(routeStopsHaveVisits([{ visits: [] }, { visits: [{ id: "visit-a" }] }])).toBe(true)
  })
})
