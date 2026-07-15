import { describe, expect, it } from "vitest"
import { workdayLocationPayload } from "./workday-location"

describe("workdayLocationPayload", () => {
  it("builds a stable replay id and preserves zero telemetry", () => {
    expect(workdayLocationPayload({
      timestamp: Date.parse("2026-07-15T05:00:00.000Z"),
      coords: {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        speed: 0,
        heading: 0,
        altitude: 0,
      },
    })).toEqual({
      clientLocationId: "gps-1784091600000-0.000000-0.000000",
      latitude: 0,
      longitude: 0,
      accuracy: 0,
      speed: 0,
      heading: 0,
      altitude: 0,
      battery: null,
      recordedAt: "2026-07-15T05:00:00.000Z",
    })
  })

  it("drops invalid negative sensor values", () => {
    const payload = workdayLocationPayload({
      timestamp: 1,
      coords: { latitude: 40.4, longitude: 49.8, accuracy: -1, speed: -1, heading: -1 },
    })
    expect(payload).toMatchObject({ accuracy: null, speed: null, heading: null })
  })
})
