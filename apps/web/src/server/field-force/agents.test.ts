import { describe, expect, it } from "vitest"

import { fieldStatusFor, scoreFieldForceAgent, shapeFieldForceAgent } from "./agents"

describe("field-force agent helpers", () => {
  const now = new Date("2026-07-06T10:00:00.000Z")

  it("marks an agent offline when latest location is older than configured threshold", () => {
    const status = fieldStatusFor({
      latestLocation: {
        latitude: 40,
        longitude: 49,
        recordedAt: new Date("2026-07-06T09:39:59.000Z"),
      },
      activeVisit: null,
      plannedLateStop: null,
      now,
      userIsActive: true,
      settings: { offlineAfterMinutes: 20 },
    })

    expect(status).toEqual({ isOnline: false, fieldStatus: "OFFLINE" })
  })

  it("prioritizes check-in over late status when agent is online and has an active visit", () => {
    const status = fieldStatusFor({
      latestLocation: {
        latitude: 40,
        longitude: 49,
        recordedAt: new Date("2026-07-06T09:55:00.000Z"),
      },
      activeVisit: { status: "IN_PROGRESS" },
      plannedLateStop: { plannedAt: new Date("2026-07-06T09:00:00.000Z"), visits: [] },
      now,
      userIsActive: true,
      settings: { offlineAfterMinutes: 20 },
    })

    expect(status).toEqual({ isOnline: true, fieldStatus: "CHECKED_IN" })
  })

  it("shapes daily completion and score from route stops and visits", () => {
    const shaped = shapeFieldForceAgent(
      {
        id: "agent-a",
        userId: "user-a",
        user: { name: "Agent A", email: "a@example.com", role: "MERCHANDISER", isActive: true },
        team: { id: "team-a", name: "North" },
        teamId: "team-a",
        locations: [{ latitude: 40, longitude: 49, recordedAt: new Date("2026-07-06T09:58:00.000Z") }],
        routes: [
          {
            stops: [
              { plannedAt: new Date("2026-07-06T09:00:00.000Z"), visits: [{ status: "COMPLETED" }] },
              { plannedAt: new Date("2026-07-06T09:30:00.000Z"), visits: [] },
            ],
          },
        ],
        visits: [
          { status: "COMPLETED", store: { name: "Store A" } },
          { status: "PLANNED", store: { name: "Store B" } },
        ],
      },
      now,
      { offlineAfterMinutes: 20 },
    )

    expect(shaped).toMatchObject({
      isOnline: true,
      fieldStatus: "LATE",
      routeCompletion: 50,
      visitsToday: 2,
      completedVisitsToday: 1,
      lastCustomer: "Store A",
    })
    expect(scoreFieldForceAgent(shaped)).toBe(60)
  })
})
