import { describe, expect, it } from "vitest"
import { distanceMeters, evaluateVisitGeofence } from "./geofence.ts"

describe("field-force geofence", () => {
  it("calculates nearby points in meters", () => {
    const distance = distanceMeters(
      { latitude: 40.4093, longitude: 49.8671 },
      { latitude: 40.4099, longitude: 49.8671 },
    )
    expect(distance).toBeGreaterThan(60)
    expect(distance).toBeLessThan(80)
  })

  it("flags check-in outside allowed radius", () => {
    const result = evaluateVisitGeofence({
      store: { latitude: 40.4093, longitude: 49.8671 },
      checkIn: { latitude: 40.4193, longitude: 49.8671 },
      limitM: 150,
    })
    expect(result.outside).toBe(true)
    expect(result.distanceM).toBeGreaterThan(1000)
  })
})
