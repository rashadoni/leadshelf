import { beforeEach, describe, expect, it, vi } from "vitest"

const locationMocks = vi.hoisted(() => ({
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}))

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  ...locationMocks,
}))

import { getCurrentDeviceLocation } from "./device-location"

const reading = {
  coords: { latitude: 40.3777, longitude: 49.892, accuracy: 12 },
  timestamp: Date.parse("2026-07-12T08:00:00.000Z"),
}

describe("getCurrentDeviceLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ granted: true })
    locationMocks.getLastKnownPositionAsync.mockResolvedValue(null)
    locationMocks.getCurrentPositionAsync.mockResolvedValue(reading)
  })

  it("uses a recent last-known reading before requesting a new GPS fix", async () => {
    locationMocks.getLastKnownPositionAsync.mockResolvedValue(reading)

    await expect(getCurrentDeviceLocation()).resolves.toEqual({
      latitude: 40.3777,
      longitude: 49.892,
      accuracyM: 12,
      recordedAt: "2026-07-12T08:00:00.000Z",
    })
    expect(locationMocks.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: 30_000,
      requiredAccuracy: 100,
    })
    expect(locationMocks.getCurrentPositionAsync).not.toHaveBeenCalled()
  })

  it("falls back to a current reading when no fresh cached fix exists", async () => {
    await expect(getCurrentDeviceLocation()).resolves.toMatchObject({ latitude: 40.3777, longitude: 49.892 })
    expect(locationMocks.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 })
  })

  it("still requests a current reading when the cached-location lookup fails", async () => {
    locationMocks.getLastKnownPositionAsync.mockRejectedValue(new Error("cache unavailable"))

    await expect(getCurrentDeviceLocation()).resolves.toMatchObject({ accuracyM: 12 })
    expect(locationMocks.getCurrentPositionAsync).toHaveBeenCalledOnce()
  })

  it("returns null when foreground permission is denied", async () => {
    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ granted: false })
    locationMocks.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false })

    await expect(getCurrentDeviceLocation()).resolves.toBeNull()
    expect(locationMocks.getLastKnownPositionAsync).not.toHaveBeenCalled()
    expect(locationMocks.getCurrentPositionAsync).not.toHaveBeenCalled()
  })
})
