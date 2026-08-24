import type { FieldContact, FieldContactUpdatePayload } from "./contracts"

/**
 * Agent-side draft for a manager-reviewed correction. This deliberately
 * covers only attributes present in the field contact response: the phone
 * never writes master data directly and never invents a hidden field.
 */
export type FieldContactCorrectionDraft = {
  firstName: string
  lastName: string
  middleName: string
  specialtyName: string
  qualificationCategory: string
  profile: string
  email: string
  phone: string
  messengerPhone: string
  notes: string
}

export type FieldContactCorrectionField = keyof FieldContactCorrectionDraft

export type FieldContactCorrectionChange = {
  field: FieldContactCorrectionField
  before: string | null
  after: string | null
}

export type FieldContactCorrectionIssue =
  | "FIRST_NAME_REQUIRED"
  | "LAST_NAME_REQUIRED"
  | "EMAIL_INVALID"
  | "NO_CHANGES"

const OPTIONAL_FIELDS = [
  "middleName",
  "specialtyName",
  "qualificationCategory",
  "profile",
  "email",
  "phone",
  "messengerPhone",
  "notes",
] as const satisfies readonly Exclude<FieldContactCorrectionField, "firstName" | "lastName">[]

function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed || null
}

function required(value: string): string {
  return value.trim()
}

export function fieldContactCorrectionDraft(contact: FieldContact): FieldContactCorrectionDraft {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    middleName: contact.middleName ?? "",
    specialtyName: contact.specialtyName ?? "",
    qualificationCategory: contact.qualificationCategory ?? "",
    profile: contact.profile ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    messengerPhone: contact.messengerPhone ?? "",
    notes: contact.notes ?? "",
  }
}

export function fieldContactCorrectionChanges(
  contact: FieldContact,
  draft: FieldContactCorrectionDraft,
): FieldContactCorrectionChange[] {
  const original = fieldContactCorrectionDraft(contact)
  const changes: FieldContactCorrectionChange[] = []

  for (const field of ["firstName", "lastName"] as const) {
    const before = required(original[field])
    const after = required(draft[field])
    if (before !== after) changes.push({ field, before, after })
  }

  for (const field of OPTIONAL_FIELDS) {
    const before = optional(original[field])
    const after = optional(draft[field])
    if (before !== after) changes.push({ field, before, after })
  }

  return changes
}

export function buildFieldContactUpdatePayload(
  contact: FieldContact,
  draft: FieldContactCorrectionDraft,
): FieldContactUpdatePayload {
  return fieldContactCorrectionChanges(contact, draft).reduce<FieldContactUpdatePayload>((payload, change) => {
    if (change.field === "firstName" || change.field === "lastName") {
      payload[change.field] = change.after ?? ""
    } else {
      payload[change.field] = change.after
    }
    return payload
  }, {})
}

export function fieldContactCorrectionIssue(
  contact: FieldContact,
  draft: FieldContactCorrectionDraft,
): FieldContactCorrectionIssue | null {
  if (!required(draft.firstName)) return "FIRST_NAME_REQUIRED"
  if (!required(draft.lastName)) return "LAST_NAME_REQUIRED"
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return "EMAIL_INVALID"
  if (fieldContactCorrectionChanges(contact, draft).length === 0) return "NO_CHANGES"
  return null
}
