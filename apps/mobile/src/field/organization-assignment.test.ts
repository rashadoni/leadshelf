import { describe, expect, it } from "vitest"
import { HttpError } from "../sync/ports-error"
import {
  assignedOrganizationTarget,
  canSearchUnassignedOrganization,
  existingOrganizationAssignmentFailure,
  fieldOrganizationQuery,
} from "./organization-assignment"

describe("existing organization route assignment", () => {
  it("builds a date-scoped unassigned search without broad catalogue defaults", () => {
    expect(fieldOrganizationQuery({
      search: "  Central Clinic  ",
      page: 1,
      limit: 20,
      assignmentState: "UNASSIGNED",
      asOf: "2026-09-10",
      status: "ACTIVE",
      objectType: "CLINIC",
      organizationKind: "Hospital",
    })).toBe(
      "page=1&limit=20&search=Central+Clinic&assignmentState=UNASSIGNED&asOf=2026-09-10&status=ACTIVE&objectType=CLINIC&organizationKind=Hospital",
    )
    expect(canSearchUnassignedOrganization(" A ")).toBe(false)
    expect(canSearchUnassignedOrganization(" AB ")).toBe(true)
  })

  it("reports a stale assignment as a conflict instead of a transfer", () => {
    expect(existingOrganizationAssignmentFailure(new HttpError(403))).toBe("denied")
    expect(existingOrganizationAssignmentFailure(new HttpError(409, undefined, {
      code: "MTM_ASSIGNMENT_NOT_UNASSIGNED",
    }))).toBe("alreadyAssigned")
    expect(existingOrganizationAssignmentFailure(new HttpError(409, undefined, {
      code: "MTM_ASSIGNMENT_CONFLICT",
    }))).toBe("generic")
  })

  it("selects only the newly eligible organization target, never a contact shortcut", () => {
    const customer = {
      id: "customer-1",
      name: "Clinic",
      code: null,
      objectType: "CLINIC",
      category: "A",
      address: null,
      city: null,
      phone: null,
      latitude: null,
      longitude: null,
    }
    const availability = { source: "CUSTOMER_ASSIGNMENT" as const, validFrom: "2026-09-10", validThrough: null }
    const contact = {
      targetKey: "contact:doctor-1",
      subjectType: "CONTACT" as const,
      customer,
      contact: { id: "doctor-1", displayName: "Dr A", type: "DOCTOR", specialtyName: null, phone: null },
      availability,
    }
    const organization = {
      targetKey: "customer:customer-1",
      subjectType: "ORGANIZATION" as const,
      customer,
      contact: null,
      availability,
    }
    expect(assignedOrganizationTarget([contact], customer.id)).toBeNull()
    expect(assignedOrganizationTarget([contact, organization], customer.id)).toBe(organization)
  })
})
