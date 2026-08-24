import { describe, expect, it } from "vitest"
import { presentFieldAttendancePolicy } from "./attendance-policy"

describe("field attendance policy presentation", () => {
  it("defaults an older server response to no location collection", () => {
    expect(presentFieldAttendancePolicy(null)).toMatchObject({
      requiresQrBeforeStart: false,
      capturesEventGps: false,
      runsContinuousTracking: false,
      usesGps: false,
      evidenceKey: "workdayEvidence_NONE",
      hintKey: "workdayPolicyNoLocation",
    })
  })

  it("distinguishes event-only GPS from continuous active-workday tracking", () => {
    expect(presentFieldAttendancePolicy({
      clockEvidence: "GPS",
      continuousTracking: "OFF",
      allowDifferentStartEndSites: true,
    })).toMatchObject({
      capturesEventGps: true,
      runsContinuousTracking: false,
      usesGps: true,
      hintKey: "workdayPolicyEventGps",
    })

    expect(presentFieldAttendancePolicy({
      clockEvidence: "GPS",
      continuousTracking: "ACTIVE_WORKDAY",
      allowDifferentStartEndSites: true,
    })).toMatchObject({
      capturesEventGps: true,
      runsContinuousTracking: true,
      usesGps: true,
      hintKey: "workdayPolicyContinuousGps",
    })
  })

  it("does not treat QR evidence as continuous GPS", () => {
    expect(presentFieldAttendancePolicy({
      clockEvidence: "QR",
      continuousTracking: "ACTIVE_WORKDAY",
      allowDifferentStartEndSites: true,
    })).toMatchObject({
      requiresQrBeforeStart: true,
      capturesEventGps: false,
      runsContinuousTracking: false,
      usesGps: false,
      hintKey: "workdayPolicyQrPending",
    })
  })
})
