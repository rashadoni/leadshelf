import { describe, expect, it } from "vitest"
import {
  FieldContractError,
  parseFieldContactDetail,
  parseFieldContacts,
  parseFieldCustomerRequest,
  parseFieldCustomerRequests,
  parseFieldNotifications,
  parseFieldOrganizationDetail,
  parseFieldOrganizations,
  parseFieldLocationHistory,
  parseFieldProfile,
  parseFieldVisitWorkspace,
  parseFieldWeek,
  parseFieldWorkday,
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

  it("accepts an active workday and zero-valued GPS telemetry", () => {
    const workday = {
      id: "workday-1",
      workDate: "2026-07-15T00:00:00.000Z",
      status: "STARTED",
      startedAt: "2026-07-15T05:00:00.000Z",
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      workedSeconds: 120,
      startLatitude: 0,
      startLongitude: 0,
      endLatitude: null,
      endLongitude: null,
      availableActions: ["PAUSE", "FINISH"],
      events: [{
        id: "event-1",
        clientEventId: "mobile-event-1",
        type: "START",
        occurredAt: "2026-07-15T05:00:00.000Z",
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        note: null,
      }],
    }
    expect(parseFieldWorkday({
      success: true,
      data: {
        date: "2026-07-15",
        today: "2026-07-15",
        timezone: "Asia/Baku",
        gpsIntervalSeconds: 30,
        workday,
        activeWorkday: workday,
        availableActions: ["PAUSE", "FINISH"],
      },
    }).workday?.status).toBe("STARTED")

    expect(parseFieldLocationHistory({
      success: true,
      data: {
        date: "2026-07-15",
        timezone: "Asia/Baku",
        gpsIntervalSeconds: 30,
        distanceMeters: 0,
        locations: [{
          id: "location-1",
          clientLocationId: "gps-1",
          latitude: 0,
          longitude: 0,
          accuracy: 0,
          speed: 0,
          heading: 0,
          altitude: 0,
          battery: null,
          isMoving: false,
          recordedAt: "2026-07-15T05:00:00.000Z",
        }],
      },
    }).locations[0]).toMatchObject({ latitude: 0, speed: 0, isMoving: false })
  })

  it("rejects invalid workday transitions and location coordinates at the boundary", () => {
    expect(() => parseFieldWorkday({
      success: true,
      data: {
        date: "2026-07-15",
        today: "2026-07-15",
        timezone: "Asia/Baku",
        gpsIntervalSeconds: 30,
        workday: null,
        activeWorkday: null,
        availableActions: ["RESTART"],
      },
    })).toThrow(FieldContractError)
    expect(() => parseFieldLocationHistory({
      success: true,
      data: {
        date: "2026-07-15",
        timezone: "Asia/Baku",
        gpsIntervalSeconds: 30,
        distanceMeters: 0,
        locations: [{ id: "x", latitude: "40", longitude: 49, isMoving: false, recordedAt: new Date().toISOString() }],
      },
    })).toThrow(FieldContractError)
  })

  it("accepts scoped organization list and detail envelopes", () => {
    const organization = {
      id: "customer-1",
      code: "C-1",
      name: "Demo Clinic",
      objectType: "CLINIC",
      category: "A",
      status: "ACTIVE",
      address: "Nizami 1",
      city: "Baku",
      district: null,
      phone: null,
      contactPerson: null,
      latitude: null,
      longitude: null,
    }
    const envelope = {
      success: true,
      data: {
        organizations: [organization],
        total: 1,
        page: 1,
        limit: 100,
        asOf: "2026-07-15",
        timezone: "Asia/Baku",
        capabilities: { canManage: false, canRequestChanges: true },
      },
    }
    expect(parseFieldOrganizations(envelope).organizations[0]?.name).toBe("Demo Clinic")
    expect(parseFieldOrganizationDetail({
      success: true,
      data: {
        organization,
        asOf: "2026-07-15",
        timezone: "Asia/Baku",
        capabilities: { canManage: false, canRequestChanges: true },
      },
    }).organization.id).toBe("customer-1")
  })

  it("accepts scoped contact list and detail envelopes", () => {
    const contact = {
      id: "contact-1",
      externalCode: null,
      firstName: "Aygun",
      lastName: "Aliyeva",
      middleName: null,
      displayName: "Aygun Aliyeva",
      type: "DOCTOR",
      specialtyCode: "PE",
      specialtyName: "Pediatrician",
      qualificationCategory: null,
      profile: null,
      category: "B",
      status: "ACTIVE",
      birthDate: null,
      gender: null,
      email: null,
      phone: "+994500000000",
      messengerPhone: null,
      notes: null,
    }
    expect(parseFieldContacts({
      success: true,
      data: {
        contacts: [contact],
        total: 1,
        page: 1,
        limit: 100,
        asOf: "2026-07-15",
        timezone: "Asia/Baku",
        capabilities: { canManage: false, canRequestChanges: true },
      },
    }).contacts[0]?.specialtyCode).toBe("PE")
    expect(parseFieldContactDetail({
      success: true,
      data: {
        contact,
        activeAssignments: [],
        asOf: "2026-07-15",
        timezone: "Asia/Baku",
        capabilities: { canManage: false, canRequestChanges: true },
      },
    }).contact.displayName).toBe("Aygun Aliyeva")
  })

  it("accepts customer request queue and duplicate candidates", () => {
    const request = {
      id: "request-1",
      status: "SUBMITTED",
      objectType: "CLINIC",
      name: "New Clinic",
      address: null,
      city: "Baku",
      phone: "+994500000001",
      potential: "HIGH",
      reason: "New territory",
      agentComment: null,
      submittedAt: "2026-07-15T08:00:00.000Z",
      updatedAt: "2026-07-15T08:00:00.000Z",
      route: null,
      approvedCustomer: null,
      duplicateCandidates: [{ id: "customer-1", name: "Clinic", score: 92, reasons: ["SIMILAR_NAME"] }],
    }
    expect(parseFieldCustomerRequests({ success: true, data: { requests: [request] } }).requests).toHaveLength(1)
    expect(parseFieldCustomerRequest({ success: true, data: request }).duplicateCandidates[0]?.score).toBe(92)
  })

  it("validates the visit workspace policy and completed evidence", () => {
    const workspace = {
      success: true,
      data: {
        visit: {
          id: "visit-1",
          agentId: "agent-1",
          customerId: "customer-1",
          contactId: null,
          routeId: "route-1",
          routePointId: "point-1",
          status: "CHECKED_IN",
          checkInAt: "2026-07-15T08:00:00.000Z",
          customer: { id: "customer-1", name: "Clinic", objectType: "CLINIC" },
          contact: null,
          requirementSnapshot: {
            id: "snapshot-1",
            sourcePolicyId: "policy-1",
            resolvedAt: "2026-07-15T08:00:00.000Z",
            sourcePolicy: { id: "policy-1", name: "Clinic visit" },
            requirements: [{
              id: "requirement-1",
              actionKey: "VISIT_NOTE",
              mode: "REQUIRED",
              minCount: 1,
              conditions: null,
              allowWaiver: false,
            }],
          },
          actionResults: [{
            id: "action-1",
            requirementId: "requirement-1",
            actionKey: "VISIT_NOTE",
            status: "COMPLETED",
            evidence: { note: "Done" },
            completedAt: "2026-07-15T08:10:00.000Z",
            createdAt: "2026-07-15T08:10:00.000Z",
          }],
          photos: [],
          tasks: [],
        },
        reminders: [],
      },
    }
    expect(parseFieldVisitWorkspace(workspace).visit.actionResults[0]?.actionKey).toBe("VISIT_NOTE")
    expect(() => parseFieldVisitWorkspace({
      ...workspace,
      data: {
        ...workspace.data,
        visit: {
          ...workspace.data.visit,
          requirementSnapshot: {
            ...workspace.data.visit.requirementSnapshot,
            requirements: [{
              ...workspace.data.visit.requirementSnapshot.requirements[0],
              actionKey: "UNKNOWN",
            }],
          },
        },
      },
    })).toThrow(FieldContractError)
  })

  it("rejects malformed master data and request envelopes", () => {
    expect(() => parseFieldOrganizations({ success: true, data: { organizations: [{}] } })).toThrow(FieldContractError)
    expect(() => parseFieldContacts({ success: true, data: { contacts: [{ id: "c" }] } })).toThrow(FieldContractError)
    expect(() => parseFieldCustomerRequests({ success: true, data: { requests: [{ status: "SUBMITTED" }] } })).toThrow(FieldContractError)
  })
})
