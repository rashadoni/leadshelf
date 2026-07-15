import { describe, expect, it } from "vitest"
import {
  FieldContractError,
  parseFieldNotifications,
  parseFieldProfile,
  parseFieldWeek,
} from "./contracts"

function day(date: string) {
  return {
    date,
    isToday: false,
    isWeekend: false,
    isWorkingDay: true,
    nonWorkingReason: null,
    calendarKind: "WORKING_DAY",
    calendarSource: "WEEKDAY_DEFAULT",
    calendarOverrideId: null,
    movedToDate: null,
    routePlanningAllowed: true,
    routes: [],
    tasks: { total: 0, completed: 0, overdue: 0, items: [] },
    visits: { total: 0, completed: 0, items: [] },
  }
}

describe("LeadDrive field contracts", () => {
  it("accepts the profile envelope used by the mobile dashboard", () => {
    const profile = parseFieldProfile({
      success: true,
      data: {
        agent: {
          id: "agent-1",
          name: "Farid",
          email: "farid@example.com",
          phone: null,
          role: "AGENT",
          status: "ACTIVE",
          avatar: null,
          isOnline: true,
          organizationId: "org-1",
          organizationName: "Demo",
          manager: null,
        },
        todaySummary: {
          date: "2026-07-15",
          timezone: "Asia/Baku",
          visits: 2,
          tasksCompleted: 3,
          routes: 1,
          routePoints: 6,
          routeVisited: 2,
          routeStatus: "IN_PROGRESS",
          routeStatuses: ["IN_PROGRESS"],
        },
        capabilities: { shelfExecution: { enabled: true, reason: null } },
      },
    })

    expect(profile.agent.name).toBe("Farid")
    expect(profile.todaySummary.routeVisited).toBe(2)
  })

  it("rejects a successful-looking but incomplete profile", () => {
    expect(() => parseFieldProfile({ success: true, data: { agent: { id: "a" } } })).toThrow(
      FieldContractError,
    )
  })

  it("accepts exactly seven validated week days", () => {
    const days = Array.from({ length: 7 }, (_, index) => day(`2026-07-${String(13 + index).padStart(2, "0")}`))
    const week = parseFieldWeek({
      success: true,
      data: {
        protocolVersion: 2,
        timezone: "Asia/Baku",
        weekStart: "2026-07-13",
        weekEndExclusive: "2026-07-20",
        today: "2026-07-15",
        calendarSource: "WORK_CALENDAR_V1",
        days,
        summary: {
          routes: 1,
          draftRoutes: 0,
          plannedStops: 6,
          visitedStops: 2,
          missedStops: 0,
          tasks: 3,
          tasksCompleted: 1,
          visits: 2,
          visitsCompleted: 1,
          coverage: { plannedCustomers: 6, coveredCustomers: 2, percentage: 33.3 },
        },
        capabilities: {
          createOwnDraft: true,
          editOwnDraft: true,
          selfPublish: false,
          requestRouteChange: true,
          requestCustomer: true,
        },
      },
    })

    expect(week.days).toHaveLength(7)
    expect(week.summary.coverage.percentage).toBe(33.3)
  })

  it("rejects a partial week so stale UI is not overwritten", () => {
    expect(() => parseFieldWeek({ success: true, data: { days: [] } })).toThrow(FieldContractError)
  })

  it("validates the agent inbox envelope", () => {
    const inbox = parseFieldNotifications({
      success: true,
      data: {
        unread: 1,
        items: [{
          id: "n1",
          title: "Route changed",
          body: null,
          type: "warning",
          isRead: false,
          metadata: null,
          createdAt: "2026-07-15T10:00:00.000Z",
        }],
      },
    })
    expect(inbox.unread).toBe(1)
  })
})
