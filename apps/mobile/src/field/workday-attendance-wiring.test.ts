import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workdaySource = readFileSync(
  new URL("../../app/(app)/workday.tsx", import.meta.url),
  "utf8",
)

describe("workday attendance H5 wiring", () => {
  it("keeps a scanned QR in the immediate lane and out of durable workday persistence", () => {
    expect(workdaySource).toContain("const qrToken = result.data.trim()")
    expect(workdaySource).toContain("parseFieldEphemeralWorkdayEventPayload")
    expect(workdaySource).toContain("await fieldApi.pushEphemeralWorkday")
    expect(workdaySource).toContain("if (requirements.requiresEphemeralQrSubmission)")

    const durableStart = workdaySource.indexOf("const queued = enqueueFieldWorkdayEvent")
    const durableBranch = workdaySource.slice(
      durableStart,
      workdaySource.indexOf("await syncWorkforce()", durableStart),
    )
    expect(durableBranch).toContain("attendance: { device }")
    expect(durableBranch).not.toContain("qrToken")
    expect(workdaySource).not.toContain("setQrToken")
  })

  it("waits for manager activation before a newly enrolled device can sign", () => {
    expect(workdaySource).toContain('status: "PENDING"')
    expect(workdaySource).toContain("await fieldApi.attendanceDeviceEnrollments()")
    expect(workdaySource).toContain('if (enrollment.status !== "ACTIVE")')
    expect(workdaySource).toContain("workforceDeviceAttendanceChallenge")
  })
})
