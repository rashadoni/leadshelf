import { describe, expect, it } from "vitest"
import type { FieldRoutePoint, FieldWeekData } from "./contracts"
import {
  completeOptimisticFieldVisit,
  findFieldVisit,
  startOptimisticFieldVisit,
} from "./visit-cache"

const point: FieldRoutePoint = {
  id: "point-1",
  customerId: "clinic-1",
  contactId: "doctor-1",
  orderIndex: 0,
  status: "PENDING",
  effectiveStatus: "PENDING",
  plannedTime: "2026-07-15T08:00:00.000Z",
  visitedAt: null,
  notes: null,
  customer: {
    id: "clinic-1",
    name: "Clinic One",
    code: "C-1",
    objectType: "CLINIC",
    category: "A",
    address: "Baku",
    city: "Baku",
    phone: null,
    latitude: 40.4,
    longitude: 49.8,
  },
  contact: {
    id: "doctor-1",
    displayName: "Dr Ali",
    type: "DOCTOR",
    specialtyName: "Cardiology",
    phone: null,
  },
  visitPolicy: {
    sourcePolicyId: "policy-1",
    sourcePolicyName: "Clinic visit",
    requirements: [{
      actionKey: "VISIT_NOTE",
      mode: "REQUIRED",
      minCount: 1,
      conditions: null,
      allowWaiver: false,
    }],
  },
}

const week = {
  protocolVersion: 2,
  timezone: "Asia/Baku",
  weekStart: "2026-07-13",
  weekEndExclusive: "2026-07-20",
  today: "2026-07-15",
  calendarSource: "WORK_CALENDAR_V1",
  days: [{
    date: "2026-07-15",
    routes: [{
      id: "route-1",
      persistedStatus: "PLANNED",
      effectiveStatus: "PLANNED",
      totalPoints: 1,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      points: [point],
    }],
    visits: { total: 0, completed: 0, items: [] },
  }],
  summary: {
    visits: 0,
    visitsCompleted: 0,
    visitedStops: 0,
    coverage: { plannedCustomers: 1, coveredCustomers: 0, percentage: 0 },
  },
} as unknown as FieldWeekData

describe("optimistic field visit cache", () => {
  it("starts a durable local visit and exposes it from the week cache", () => {
    const next = startOptimisticFieldVisit(week, {
      visitId: "field-visit-1",
      routeId: "route-1",
      routePoint: point,
      routeDate: "2026-07-15",
      checkInAt: "2026-07-15T08:00:00.000Z",
    })
    expect(findFieldVisit(next, "field-visit-1")).toMatchObject({
      status: "CHECKED_IN",
      contactId: "doctor-1",
      syncState: "PENDING",
    })
    expect(next.days[0]?.routes[0]).toMatchObject({ effectiveStatus: "IN_PROGRESS" })
    expect(next.summary.visits).toBe(1)
  })

  it("completes the point once and recalculates route coverage", () => {
    const started = startOptimisticFieldVisit(week, {
      visitId: "field-visit-1",
      routeId: "route-1",
      routePoint: point,
      routeDate: "2026-07-15",
      checkInAt: "2026-07-15T08:00:00.000Z",
    })
    const completed = completeOptimisticFieldVisit(started, {
      visitId: "field-visit-1",
      checkOutAt: "2026-07-15T08:30:00.000Z",
      outcome: "SUCCESSFUL",
      potential: "HIGH",
      resultNotes: "Agreed next step",
    })
    expect(findFieldVisit(completed, "field-visit-1")).toMatchObject({
      status: "CHECKED_OUT",
      outcome: "SUCCESSFUL",
    })
    expect(completed.days[0]?.routes[0]).toMatchObject({
      effectiveStatus: "COMPLETED",
      visitedPoints: 1,
    })
    expect(completed.summary).toMatchObject({
      visitsCompleted: 1,
      visitedStops: 1,
      coverage: { plannedCustomers: 1, coveredCustomers: 1, percentage: 100 },
    })
    expect(completeOptimisticFieldVisit(completed, {
      visitId: "field-visit-1",
      checkOutAt: "2026-07-15T08:31:00.000Z",
      outcome: "SUCCESSFUL",
      potential: "HIGH",
      resultNotes: null,
    })).toBe(completed)
  })
})
