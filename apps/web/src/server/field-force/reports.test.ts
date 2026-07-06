import { describe, expect, it } from "vitest"

import { percent, shapeLeaderboard, summarizeFieldForceReport } from "./reports"

describe("field-force reports helpers", () => {
  it("keeps percent safe for empty totals", () => {
    expect(percent(0, 0)).toBe(0)
    expect(percent(3, 4)).toBe(75)
  })

  it("summarizes route execution and agent status", () => {
    const summary = summarizeFieldForceReport(
      [
        { id: "r1", name: "Route 1", status: "COMPLETED", totalPoints: 4, visitedPoints: 4 },
        { id: "r2", name: "Route 2", status: "IN_PROGRESS", totalPoints: 6, visitedPoints: 3 },
        { id: "r3", name: "Route 3", status: "PLANNED", totalPoints: 2, visitedPoints: 0 },
      ],
      [
        {
          id: "a1",
          name: "Agent 1",
          isOnline: true,
          fieldStatus: "ON_ROAD",
          routeCompletion: 100,
          visitsToday: 4,
          completedVisitsToday: 4,
        },
        {
          id: "a2",
          name: "Agent 2",
          isOnline: true,
          fieldStatus: "LATE",
          routeCompletion: 50,
          visitsToday: 3,
          completedVisitsToday: 1,
        },
      ],
    )

    expect(summary).toMatchObject({
      totalRoutes: 3,
      completedRoutes: 1,
      inProgressRoutes: 1,
      plannedRoutes: 1,
      totalPoints: 12,
      visitedPoints: 7,
      completion: 58,
      onlineAgents: 2,
      lateAgents: 1,
    })
  })

  it("sorts leaderboard by server-side score", () => {
    const leaderboard = shapeLeaderboard([
      {
        id: "a1",
        name: "Agent 1",
        isOnline: false,
        fieldStatus: "OFFLINE",
        routeCompletion: 30,
        visitsToday: 1,
        completedVisitsToday: 1,
      },
      {
        id: "a2",
        name: "Agent 2",
        isOnline: true,
        fieldStatus: "ON_ROAD",
        routeCompletion: 80,
        visitsToday: 2,
        completedVisitsToday: 2,
      },
    ])

    expect(leaderboard.map((agent) => [agent.id, agent.score])).toEqual([
      ["a2", 130],
      ["a1", 50],
    ])
  })
})
