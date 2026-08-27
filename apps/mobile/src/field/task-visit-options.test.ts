import { describe, expect, it } from "vitest"
import type { FieldWeekData, FieldWeekVisit } from "./contracts"
import { fieldTaskVisitOptions } from "./task-visit-options"

function visit(input: Partial<FieldWeekVisit> & Pick<FieldWeekVisit, "id" | "customerId" | "customer">): FieldWeekVisit {
  return {
    contactId: null,
    routeId: null,
    routePointId: null,
    status: "CHECKED_IN",
    checkInAt: "2026-08-25T08:00:00.000Z",
    checkOutAt: null,
    outcome: null,
    potential: null,
    notes: null,
    resultNotes: null,
    contact: null,
    ...input,
  }
}

const clinic = { id: "clinic-1", name: "Clinic One", objectType: "CLINIC" }
const pharmacy = { id: "pharmacy-1", name: "Pharmacy One", objectType: "PHARMACY" }

function week(days: Array<{ date: string; visits: FieldWeekVisit[] }>): Pick<FieldWeekData, "days"> {
  return {
    days: days.map((day) => ({
      date: day.date,
      visits: { total: day.visits.length, completed: 0, items: day.visits },
    })) as FieldWeekData["days"],
  }
}

describe("field task visit options", () => {
  it("uses only current-week visits and prioritizes the selected customer and day", () => {
    const data = week([
      {
        date: "2026-08-24",
        visits: [visit({
          id: "visit-completed",
          customerId: clinic.id,
          customer: clinic,
          status: "CHECKED_OUT",
          checkOutAt: "2026-08-24T09:00:00.000Z",
        })],
      },
      {
        date: "2026-08-25",
        visits: [
          visit({ id: "visit-pharmacy", customerId: pharmacy.id, customer: pharmacy }),
          visit({ id: "visit-clinic", customerId: clinic.id, customer: clinic, checkInAt: "2026-08-25T10:00:00.000Z" }),
        ],
      },
    ])

    expect(fieldTaskVisitOptions(data, {
      canCreateTask: true,
      selectedCustomerId: clinic.id,
      selectedDate: "2026-08-25",
    }).map((option) => option.id)).toEqual([
      "visit-clinic",
      "visit-completed",
      "visit-pharmacy",
    ])
  })

  it("keeps a pending local visit but omits conflict and rejected visits", () => {
    const data = week([{
      date: "2026-08-25",
      visits: [
        visit({ id: "visit-pending", customerId: clinic.id, customer: clinic, syncState: "PENDING" }),
        visit({ id: "visit-conflict", customerId: clinic.id, customer: clinic, syncState: "CONFLICT" }),
        visit({ id: "visit-rejected", customerId: clinic.id, customer: clinic, syncState: "REJECTED" }),
      ],
    }])

    expect(fieldTaskVisitOptions(data, { canCreateTask: true })).toEqual([
      expect.objectContaining({ id: "visit-pending", state: "SYNCING" }),
    ])
  })

  it("does not expose visit choices without self-task capability", () => {
    const data = week([{
      date: "2026-08-25",
      visits: [visit({ id: "visit-1", customerId: clinic.id, customer: clinic })],
    }])

    expect(fieldTaskVisitOptions(data, { canCreateTask: false })).toEqual([])
    expect(fieldTaskVisitOptions(null, { canCreateTask: true })).toEqual([])
  })
})
