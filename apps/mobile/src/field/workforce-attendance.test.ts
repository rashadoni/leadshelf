import { describe, expect, it } from "vitest"
import {
  FieldAttendanceContractError,
  fieldAttendanceRequirementsForAction,
  parseFieldDurableWorkdayAttendanceEvidence,
  parseFieldTransientWorkdayAttendanceEvidence,
  parseFieldWorkforceAttendanceManifest,
  workforceDeviceAttendanceChallenge,
  workforceDeviceEnrollmentChallenge,
} from "./workforce-attendance"

const activeAttendance = {
  qrEnabled: true,
  deviceTrustEnabled: true,
  status: "ACTIVE" as const,
  enforcementVersion: 1 as const,
  configVersion: "policy-1:4:7af23c",
  qrRequiredActions: ["START", "FINISH"] as const,
  deviceTrustRequiredActions: ["START", "PAUSE", "FINISH"] as const,
  biometricRequiredActions: ["START"] as const,
}

describe("workforce attendance trust contract", () => {
  it("accepts only the known active H5 policy and derives action requirements", () => {
    const manifest = parseFieldWorkforceAttendanceManifest(activeAttendance)

    expect(fieldAttendanceRequirementsForAction(manifest, "START")).toEqual({
      status: "ACTIVE",
      blocked: false,
      qrRequired: true,
      deviceTrustRequired: true,
      biometricRequired: true,
      requiresEphemeralQrSubmission: true,
    })
    expect(fieldAttendanceRequirementsForAction(manifest, "PAUSE")).toEqual({
      status: "ACTIVE",
      blocked: false,
      qrRequired: false,
      deviceTrustRequired: true,
      biometricRequired: false,
      requiresEphemeralQrSubmission: false,
    })
  })

  it("fails closed for unknown or internally inconsistent active policy material", () => {
    expect(() => parseFieldWorkforceAttendanceManifest({
      ...activeAttendance,
      status: "EXPERIMENTAL",
    })).toThrow(FieldAttendanceContractError)
    expect(() => parseFieldWorkforceAttendanceManifest({
      ...activeAttendance,
      enforcementVersion: 2,
    })).toThrow(FieldAttendanceContractError)
    expect(() => parseFieldWorkforceAttendanceManifest({
      ...activeAttendance,
      biometricRequiredActions: ["RESUME"],
    })).toThrow(FieldAttendanceContractError)

    const invalid = parseFieldWorkforceAttendanceManifest({
      qrEnabled: true,
      deviceTrustEnabled: true,
      status: "INVALID",
      enforcementVersion: null,
      configVersion: "policy-1:4:7af23c",
      qrRequiredActions: [],
      deviceTrustRequiredActions: [],
      biometricRequiredActions: [],
    })
    expect(fieldAttendanceRequirementsForAction(invalid, "START")).toMatchObject({
      status: "INVALID",
      blocked: true,
    })
  })

  it("builds the exact newline-delimited server signature challenge", () => {
    expect(workforceDeviceAttendanceChallenge({
      organizationId: "org-1",
      agentId: "agent-1",
      enrollmentId: "enrollment-1",
      clientEventId: "field-workday-start-1",
      action: "START",
      workdayId: "workday-1",
      occurredAt: "2026-08-29T08:00:00.000Z",
    })).toBe([
      "workforce-device-attendance:v1",
      "organizationId=org-1",
      "agentId=agent-1",
      "enrollmentId=enrollment-1",
      "clientEventId=field-workday-start-1",
      "action=START",
      "workdayId=workday-1",
      "occurredAt=2026-08-29T08:00:00.000Z",
    ].join("\n"))

    expect(() => workforceDeviceAttendanceChallenge({
      organizationId: "org-1\nattacker=true",
      agentId: "agent-1",
      enrollmentId: "enrollment-1",
      clientEventId: "field-workday-start-1",
      action: "START",
      workdayId: "workday-1",
      occurredAt: "2026-08-29T08:00:00.000Z",
    })).toThrow(FieldAttendanceContractError)

    // LeadDrive parses a client timestamp into a Date before serialising its
    // challenge. The mobile preimage must use that same canonical instant.
    expect(workforceDeviceAttendanceChallenge({
      organizationId: "org-1",
      agentId: "agent-1",
      enrollmentId: "enrollment-1",
      clientEventId: "field-workday-start-1",
      action: "START",
      workdayId: "workday-1",
      occurredAt: "2026-08-29T09:00:00+01:00",
    })).toContain("occurredAt=2026-08-29T08:00:00.000Z")
  })

  it("builds the exact one-time enrollment proof challenge", () => {
    expect(workforceDeviceEnrollmentChallenge({
      organizationId: "org-1",
      agentId: "agent-1",
      enrollmentId: "enrollment-1",
      challenge: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    })).toBe([
      "workforce-device-enrollment:v1",
      "organizationId=org-1",
      "agentId=agent-1",
      "enrollmentId=enrollment-1",
      "challenge=AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    ].join("\n"))
  })

  it("permits durable device evidence but rejects QR material from persistence", () => {
    const device = {
      enrollmentId: "device-enrollment-1",
      signature: "MEUCIQDjLdtUxrh1Sx8rTXUOmF7mnLUffedFz8L9xJoQfVHxuAIgG1qg3bzpTxl9db0dlQf5P5s=",
    }

    expect(parseFieldDurableWorkdayAttendanceEvidence({ device })).toEqual({ device })
    expect(() => parseFieldDurableWorkdayAttendanceEvidence({
      qrToken: "wa1.transient-token",
      device,
    })).toThrow(FieldAttendanceContractError)
    expect(() => parseFieldDurableWorkdayAttendanceEvidence({
      device: { ...device, signature: "signature-not-standard-base64_" },
    })).toThrow(FieldAttendanceContractError)
    expect(parseFieldTransientWorkdayAttendanceEvidence({
      qrToken: "wa1.short-lived-token",
      device,
    })).toEqual({ qrToken: "wa1.short-lived-token", device })
  })
})
