import { describe, expect, it } from "vitest"
import {
  FieldContractError,
  parseFieldContactDetail,
  parseFieldCommitments,
  parseFieldAgentTasks,
  parseFieldContacts,
  parseFieldCustomerRequest,
  parseFieldCustomerRequests,
  parseFieldNotifications,
  parseFieldMessages,
  parseFieldMessageThread,
  parseFieldDocuments,
  parseFieldHrm,
  parseFieldOrganizationDetail,
  parseFieldOrganizations,
  parseFieldPersonalKpi,
  parseFieldLocationHistory,
  parseFieldMobileBootstrap,
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
  it("accepts independent Workforce and Route module flags from bootstrap", () => {
    const bootstrap = parseFieldMobileBootstrap({
      success: true,
      data: {
        tenant: { id: "org-1", name: "Demo", slug: "demo" },
        principal: { id: "agent-1", name: "Farid", email: null, role: "AGENT" },
        capabilities: ["FIELD_EXECUTE"],
        permissions: ["WORKTIME_SELF_READ"],
        modules: {
          workforce: { enabled: true, capabilityId: "workforce-hrm", configVersion: null, cursor: null },
          routes: { enabled: false, capabilityId: "route-field", configVersion: null },
        },
        timezone: "Asia/Baku",
        policies: {
          photoWatermark: false,
          canPlanOwnRoutes: false,
          workforce: { enabled: true, configVersion: null },
        },
        routeTargetTypes: [],
        sync: { horizon: "ACTIVE_FIELD_SCOPE", scopeVersion: null, configVersion: null },
        workday: null,
      },
    })

    expect(bootstrap.modules).toMatchObject({
      workforce: { enabled: true, capabilityId: "workforce-hrm" },
      routes: { enabled: false, capabilityId: "route-field" },
    })
  })

  it("rejects a bootstrap that could expose Workforce without its matching policy", () => {
    expect(() => parseFieldMobileBootstrap({
      success: true,
      data: {
        tenant: { id: "org-1", name: "Demo", slug: "demo" },
        principal: { id: "agent-1", name: "Farid", email: null, role: "AGENT" },
        capabilities: [],
        permissions: [],
        modules: {
          workforce: { enabled: true, capabilityId: "workforce-hrm", configVersion: null, cursor: null },
          routes: { enabled: false, capabilityId: "route-field", configVersion: null },
        },
        timezone: "Asia/Baku",
        policies: {
          photoWatermark: false,
          canPlanOwnRoutes: false,
          workforce: { enabled: false, configVersion: null },
        },
        routeTargetTypes: [],
        sync: { horizon: "ACTIVE_FIELD_SCOPE", scopeVersion: null, configVersion: null },
        workday: null,
      },
    })).toThrow(FieldContractError)
  })

  it("accepts immutable commitment promise-vs-fact rows", () => {
    const data = parseFieldCommitments({
      success: true,
      data: {
        capabilities: { create: true, fulfillOwn: true },
        commitments: [{
          id: "commitment-1",
          clientCommitmentId: "client-commitment-1",
          visitId: "visit-1",
          customerId: "customer-1",
          contactId: null,
          productExternalId: "sku-1",
          productName: "ACC 200 mg",
          brandExternalId: null,
          brandName: "ACC",
          promisedQuantity: 10,
          unit: "packs",
          dueAt: "2026-07-20T18:00:00.000Z",
          note: null,
          submittedAt: "2026-07-16T08:00:00.000Z",
          status: "PARTIAL",
          customer: { id: "customer-1", name: "Clinic", objectType: "CLINIC", address: null, city: "Baku" },
          contact: null,
          evidencePhoto: null,
          fulfillment: {
            id: "fact-1",
            clientFulfillmentId: "client-fact-1",
            outcome: "PARTIAL",
            actualQuantity: 4,
            varianceQuantity: -6,
            note: "Four packs",
            fulfilledAt: "2026-07-20T10:00:00.000Z",
            evidencePhoto: null,
          },
        }],
      },
    })
    expect(data.commitments[0]).toMatchObject({
      status: "PARTIAL",
      fulfillment: { varianceQuantity: -6 },
    })
  })

  it("accepts auditable personal KPI and commercial source metrics", () => {
    const metric = { numerator: 1, denominator: 2, percentage: 50 }
    const coverage = { ...metric, uncovered: [{
      subjectKey: "customer:pharmacy-2",
      customerId: "pharmacy-2",
      contactId: null,
      name: "Aptek 2",
      segment: "PHARMACY",
    }] }
    const data = parseFieldPersonalKpi({
      success: true,
      data: {
        protocolVersion: 2,
        source: "LEADDRIVE",
        generatedAt: "2026-07-15T08:00:00.000Z",
        timezone: "Asia/Baku",
        period: {
          kind: "week",
          anchor: "2026-07-15",
          start: "2026-07-13",
          endExclusive: "2026-07-20",
          from: "2026-07-12T20:00:00.000Z",
          to: "2026-07-19T20:00:00.000Z",
        },
        visits: {
          planned: 2,
          completedPlanned: 1,
          completedTotal: 2,
          unplannedCompleted: 1,
          missed: 1,
          fulfillment: metric,
        },
        coverage: { overall: coverage, doctors: { ...metric, uncovered: [] }, pharmacies: coverage, other: { numerator: 0, denominator: 0, percentage: 0, uncovered: [] } },
        tasks: { assigned: 2, completed: 1, overdue: 1, completion: metric, overdueIds: ["task-late"] },
        gps: {
          workdays: 2,
          workdaysWithGps: 1,
          dayCoverage: metric,
          points: 120,
          distanceMeters: 12_300,
          workedSeconds: 28_800,
          averageAccuracyMeters: 11.5,
          lastRecordedAt: "2026-07-15T07:55:00.000Z",
          truncated: false,
          daysWithoutPoints: ["2026-07-14"],
        },
        drilldown: { missedStopIds: ["point-2"], unplannedVisitIds: ["visit-2"] },
        commercial: {
          availability: "READY",
          source: "LEADSHELF",
          reason: null,
          data: {
            source: "LEADSHELF",
            generatedAt: "2026-07-15T08:00:00.000Z",
            period: { kind: "week", from: "2026-07-12T20:00:00.000Z", to: "2026-07-19T20:00:00.000Z" },
            orders: {
              total: 2,
              placed: 2,
              delivered: 1,
              cancelled: 0,
              amounts: [{ currency: "AZN", totalAmount: 160.5, discountAmount: 10.25 }],
              fulfillment: metric,
              ids: ["order-1", "order-2"],
            },
            promotions: { active: 3, ordersWithPromotion: 1, distinctApplied: 1, adoption: metric },
            shelfTasks: { assigned: 2, completed: 1, overdue: 1, completion: metric, overdueIds: ["shelf-late"] },
          },
        },
      },
    })

    expect(data.coverage.pharmacies.uncovered[0]?.name).toBe("Aptek 2")
    expect(data.commercial.availability === "READY" && data.commercial.data.orders.amounts[0]).toMatchObject({ currency: "AZN", totalAmount: 160.5 })
  })

  it("rejects a KPI response that turns a commercial outage into fake zeroes", () => {
    expect(() => parseFieldPersonalKpi({
      success: true,
      data: {
        protocolVersion: 2,
        source: "LEADDRIVE",
        commercial: { availability: "READY", source: "LEADSHELF", reason: null, data: null },
      },
    })).toThrow(FieldContractError)
  })

  it("accepts versioned agent tasks with an immutable timeline", () => {
    const data = parseFieldAgentTasks({
      success: true,
      data: {
        capabilities: { createSelfTask: true, recurringTasks: true },
        tasks: [{
          id: "task-1",
          title: "Call the clinic",
          description: null,
          status: "OVERDUE",
          persistedStatus: "PENDING",
          priority: "HIGH",
          dueDate: "2026-07-14T09:00:00.000Z",
          completedAt: null,
          acceptedAt: null,
          startedAt: null,
          result: null,
          version: 2,
          customerId: "customer-1",
          visitId: null,
          sourceKey: null,
          copiedFromId: null,
          recurrenceRule: null,
          recurrenceInterval: null,
          recurrenceUntil: null,
          recurrenceParentId: null,
          canEditContent: false,
          customer: { id: "customer-1", name: "Clinic", objectType: "CLINIC", address: null, city: "Baku" },
          events: [{
            id: "event-1",
            clientEventId: null,
            type: "CREATED",
            occurredAt: "2026-07-13T09:00:00.000Z",
            comment: null,
            evidence: null,
            fromStatus: null,
            toStatus: "PENDING",
            oldDueDate: null,
            newDueDate: null,
          }],
        }],
      },
    })
    expect(data.tasks[0]).toMatchObject({ status: "OVERDUE", persistedStatus: "PENDING", version: 2 })
    expect(data.tasks[0]?.events[0]?.type).toBe("CREATED")
  })

  it("rejects an agent task without a concurrency version", () => {
    expect(() => parseFieldAgentTasks({
      success: true,
      data: { capabilities: { createSelfTask: true, recurringTasks: true }, tasks: [{ id: "task-1", title: "x" }] },
    })).toThrow(FieldContractError)
  })

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

  it("accepts direct conversations, private documents and HRM schedule", () => {
    const attachment = {
      id: "document-1",
      title: "Brief",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      checksumSha256: null,
      downloadUrl: "/api/v1/mtm/mobile/documents/document-1/download",
    }
    const person = { id: "agent-2", name: "Manager", role: "MANAGER", avatar: null }
    const lastMessage = {
      id: "message-1",
      senderAgentId: "agent-2",
      senderName: "Manager",
      body: "Please confirm",
      sentAt: "2026-07-16T08:00:00.000Z",
      acknowledgementRequired: true,
      attachmentDocument: attachment,
      acknowledged: false,
    }
    expect(parseFieldMessages({
      success: true,
      data: {
        threads: [{
          id: "thread-1",
          type: "DIRECT",
          subject: null,
          title: "Manager",
          lastMessageAt: lastMessage.sentAt,
          participants: [person],
          lastMessage,
          unread: true,
          needsAcknowledgement: true,
        }],
        unread: 1,
        availableRecipients: [person],
        capabilities: { startDirectConversation: true, sendAttachments: true, acknowledgeBroadcasts: true },
      },
    }).threads[0]?.needsAcknowledgement).toBe(true)

    expect(parseFieldMessageThread({
      success: true,
      data: {
        thread: {
          id: "thread-1",
          type: "DIRECT",
          subject: null,
          lastMessageAt: lastMessage.sentAt,
          participants: [{ ...person, participantRole: "MEMBER" }],
          messages: [{
            ...lastMessage,
            clientMessageId: null,
            senderUserId: null,
            read: false,
            receipts: [],
          }],
        },
        capabilities: { reply: true, sendAttachments: true, acknowledge: true },
      },
    }).thread.messages[0]?.body).toBe("Please confirm")

    const document = {
      ...attachment,
      clientDocumentId: null,
      uploadedByAgentId: null,
      visitId: null,
      taskId: null,
      createdAt: "2026-07-16T07:00:00.000Z",
      assignment: {
        id: "assignment-1",
        required: true,
        assignedAt: "2026-07-16T07:00:00.000Z",
        expiresAt: null,
        readAt: null,
        downloadedAt: null,
      },
      expired: false,
    }
    expect(parseFieldDocuments({
      success: true,
      data: {
        documents: [document],
        capabilities: { upload: true, offlineDownload: true, maxUploadBytes: 26_214_400 },
      },
    }).documents[0]?.assignment.required).toBe(true)

    const request = {
      id: "hrm-1",
      clientRequestId: "hrm-client-1",
      type: "LEAVE",
      status: "PENDING",
      startDate: "2026-07-20T00:00:00.000Z",
      endDate: "2026-07-22T00:00:00.000Z",
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
      reason: "Family leave",
      decisionNote: null,
      submittedAt: "2026-07-16T08:00:00.000Z",
      decidedAt: null,
      cancelledAt: null,
      updatedAt: "2026-07-16T08:00:00.000Z",
    }
    expect(parseFieldHrm({
      success: true,
      data: {
        timezone: "Asia/Baku",
        start: "2026-07-16",
        end: "2026-07-31",
        days: [{
          date: "2026-07-16",
          calendar: { isWorkingDay: true, kind: "WORKING_DAY", source: "DEFAULT", name: null, routePlanningAllowed: true },
          workday: null,
          requests: [],
        }],
        requests: [request],
        capabilities: { requestLeave: true, requestAbsence: true, requestTimeCorrection: true, cancelPending: true },
      },
    }).requests[0]?.status).toBe("PENDING")
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
