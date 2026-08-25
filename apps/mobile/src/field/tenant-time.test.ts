import { describe, expect, it } from "vitest"
import { tenantDateKey, tenantDateTimeParts, tenantDateTimeToIso } from "./tenant-time"

describe("tenant wall-clock time", () => {
  it("keeps a tenant calendar day when the device can be in another timezone", () => {
    const instant = "2026-08-24T20:15:00.000Z"
    expect(tenantDateKey(instant, "Asia/Baku")).toBe("2026-08-25")
    expect(tenantDateTimeParts(instant, "Asia/Baku")).toMatchObject({
      dateKey: "2026-08-25",
      time: "00:15",
    })
  })

  it("round-trips an explicit tenant wall-clock follow-up", () => {
    expect(tenantDateTimeToIso("2026-08-25", "09:30", "Asia/Baku"))
      .toBe("2026-08-25T05:30:00.000Z")
  })

  it("rejects a nonexistent daylight-saving wall-clock time", () => {
    expect(tenantDateTimeToIso("2026-03-29", "02:30", "Europe/Berlin")).toBeNull()
  })
})
