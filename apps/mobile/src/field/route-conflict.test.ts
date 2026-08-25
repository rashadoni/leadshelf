import { describe, expect, it } from "vitest"
import { parseFieldRouteMutationConflict, routeConflictPointIndexes } from "./route-conflict"

describe("field route mutation conflicts", () => {
  it("keeps only safe recovery facts from known API responses", () => {
    expect(parseFieldRouteMutationConflict({
      code: "ROUTE_DUPLICATE",
      duplicate: { id: "route-existing", name: "Sensitive route name" },
    })).toEqual({ kind: "duplicate", code: "ROUTE_DUPLICATE", duplicateRouteId: "route-existing" })

    const time = parseFieldRouteMutationConflict({
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{ plannedTime: "2026-07-15T05:30:00.000Z", pointIndexes: [0, 2], customerIds: ["c1", "c2"] }],
    })
    expect(time).toEqual({
      kind: "point_time",
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{ plannedTime: "2026-07-15T05:30:00.000Z", pointIndexes: [0, 2] }],
    })
    expect(routeConflictPointIndexes(time)).toEqual([0, 2])

    expect(parseFieldRouteMutationConflict({
      code: "ROUTE_CONFLICT",
      conflicts: [{ code: "AGENT_SCHEDULE_CONFLICT", routeId: "other-route", agentIds: ["agent-2"] }],
    })).toEqual({ kind: "schedule", code: "ROUTE_CONFLICT" })

    expect(parseFieldRouteMutationConflict({ code: "ROUTE_VERSION_CONFLICT", currentVersion: 4 })).toEqual({
      kind: "version",
      code: "ROUTE_VERSION_CONFLICT",
    })
  })

  it("keeps duplicate-race recovery safe and rejects malformed details", () => {
    expect(parseFieldRouteMutationConflict({ code: "ROUTE_DUPLICATE" })).toEqual({
      kind: "duplicate",
      code: "ROUTE_DUPLICATE",
      duplicateRouteId: null,
    })
    expect(parseFieldRouteMutationConflict({
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{ plannedTime: "09:30", pointIndexes: [0] }],
    })).toBeNull()
    expect(parseFieldRouteMutationConflict({ code: "ROUTE_CONFLICT", conflicts: [{ code: "UNKNOWN" }] })).toBeNull()
    expect(parseFieldRouteMutationConflict({ code: "SOMETHING_ELSE" })).toBeNull()
  })
})
