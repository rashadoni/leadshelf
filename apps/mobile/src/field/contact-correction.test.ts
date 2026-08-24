import { describe, expect, it } from "vitest"
import {
  buildFieldContactUpdatePayload,
  fieldContactChangePreview,
  fieldContactCorrectionChanges,
  fieldContactCorrectionDraft,
  fieldContactCorrectionIssue,
} from "./contact-correction"
import type { FieldContact } from "./contracts"

const contact: FieldContact = {
  id: "contact-1",
  updatedAt: "2026-08-24T10:00:00.000Z",
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

describe("field contact correction", () => {
  it("sends only normalized fields that changed", () => {
    const draft = {
      ...fieldContactCorrectionDraft(contact),
      specialtyName: " Pediatr ",
      phone: "",
      notes: "  Confirmed at the visit  ",
    }

    expect(fieldContactCorrectionChanges(contact, draft)).toEqual([
      { field: "specialtyName", before: "Pediatrician", after: "Pediatr" },
      { field: "phone", before: "+994500000000", after: null },
      { field: "notes", before: null, after: "Confirmed at the visit" },
    ])
    expect(buildFieldContactUpdatePayload(contact, draft)).toEqual({
      specialtyName: "Pediatr",
      phone: null,
      notes: "Confirmed at the visit",
    })
  })

  it("rejects empty required names, malformed email, and no-op requests", () => {
    const draft = fieldContactCorrectionDraft(contact)
    expect(fieldContactCorrectionIssue(contact, draft)).toBe("NO_CHANGES")
    expect(fieldContactCorrectionIssue(contact, { ...draft, firstName: " " })).toBe("FIRST_NAME_REQUIRED")
    expect(fieldContactCorrectionIssue(contact, { ...draft, lastName: " " })).toBe("LAST_NAME_REQUIRED")
    expect(fieldContactCorrectionIssue(contact, { ...draft, email: "not-an-email" })).toBe("EMAIL_INVALID")
  })

  it("shows only exactly understood fields to a mobile manager", () => {
    expect(fieldContactChangePreview("CONTACT_UPDATE", {
      phone: "+994501234567",
      notes: null,
    })).toEqual({
      fields: [
        { field: "phone", value: "+994501234567" },
        { field: "notes", value: null },
      ],
      needsFullReview: false,
    })
    expect(fieldContactChangePreview("CONTACT_UPDATE", { category: "A" }).needsFullReview).toBe(true)
    expect(fieldContactChangePreview("WORKPLACE_UPSERT", { customerId: "customer-1" }).needsFullReview).toBe(true)
  })
})
