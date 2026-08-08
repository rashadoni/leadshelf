import { beforeEach, describe, expect, it, vi } from "vitest"

const locationMocks = vi.hoisted(() => ({
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}))

const taskManagerMocks = vi.hoisted(() => ({
  isTaskDefined: vi.fn(),
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(),
}))

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { OtherNavigation: 4 },
  ...locationMocks,
}))

vi.mock("expo-task-manager", () => taskManagerMocks)
vi.mock("../api/mobile-client", () => ({ syncApi: { push: vi.fn() } }))
vi.mock("../db/local-store", () => ({
  enqueueFieldLocation: vi.fn(),
  localStore: { markOutbox: vi.fn() },
}))

import {
  reconcileWorkdayTracking,
  startWorkdayTracking,
  WORKDAY_LOCATION_TASK,
} from "./workday-tracking"

describe("workday tracking permission and recovery state", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    locationMocks.hasServicesEnabledAsync.mockResolvedValue(true)
    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true })
    locationMocks.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true })
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true })
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true })
    locationMocks.hasStartedLocationUpdatesAsync.mockResolvedValue(false)
    locationMocks.startLocationUpdatesAsync.mockResolvedValue(undefined)
    locationMocks.stopLocationUpdatesAsync.mockResolvedValue(undefined)
    locationMocks.watchPositionAsync.mockResolvedValue({ remove: vi.fn() })
    taskManagerMocks.isAvailableAsync.mockResolvedValue(true)
  })

  it("starts background tracking when both permissions and task runtime are available", async () => {
    const state = await startWorkdayTracking(30)

    expect(state).toMatchObject({ mode: "background", issue: "none", recovery: "none" })
    expect(locationMocks.startLocationUpdatesAsync).toHaveBeenCalledWith(
      WORKDAY_LOCATION_TASK,
      expect.objectContaining({ timeInterval: 30_000, distanceInterval: 20 }),
    )
    expect(locationMocks.watchPositionAsync).not.toHaveBeenCalled()
  })

  it("reports disabled location services without requesting permissions or inventing a fix", async () => {
    locationMocks.hasServicesEnabledAsync.mockResolvedValue(false)

    await expect(startWorkdayTracking(30)).resolves.toMatchObject({
      mode: "services_disabled",
      issue: "services_disabled",
      recovery: "open_settings",
    })
    expect(locationMocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled()
    expect(locationMocks.watchPositionAsync).not.toHaveBeenCalled()
  })

  it("distinguishes a blocked foreground permission from a requestable denial", async () => {
    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false })

    await expect(startWorkdayTracking(30, { requestForegroundPermission: false })).resolves.toMatchObject({
      mode: "denied",
      issue: "foreground_permission_blocked",
      recovery: "open_settings",
    })

    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true })
    await expect(startWorkdayTracking(30, { requestForegroundPermission: false })).resolves.toMatchObject({
      mode: "denied",
      issue: "foreground_permission_required",
      recovery: "request_permission",
    })
  })

  it("keeps a truthful foreground fallback when background permission is blocked", async () => {
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false })

    await expect(startWorkdayTracking(30)).resolves.toMatchObject({
      mode: "foreground",
      issue: "background_permission_blocked",
      recovery: "open_settings",
    })
    expect(locationMocks.watchPositionAsync).toHaveBeenCalledOnce()
    expect(locationMocks.startLocationUpdatesAsync).not.toHaveBeenCalled()
  })

  it("falls back to foreground and offers retry when background startup fails", async () => {
    locationMocks.startLocationUpdatesAsync.mockRejectedValue(new Error("native task failed"))

    await expect(startWorkdayTracking(30)).resolves.toMatchObject({
      mode: "foreground",
      issue: "tracking_start_failed",
      recovery: "retry_tracking",
    })
    expect(locationMocks.watchPositionAsync).toHaveBeenCalledOnce()
  })

  it("reports unavailable when neither background nor foreground tracking can start", async () => {
    locationMocks.startLocationUpdatesAsync.mockRejectedValue(new Error("native task failed"))
    locationMocks.watchPositionAsync.mockRejectedValue(new Error("watch failed"))

    await expect(startWorkdayTracking(30)).resolves.toMatchObject({
      mode: "unavailable",
      issue: "tracking_start_failed",
      recovery: "retry_tracking",
    })
  })

  it("stops every tracker when the server workday is no longer active", async () => {
    locationMocks.hasStartedLocationUpdatesAsync.mockResolvedValue(true)

    await expect(reconcileWorkdayTracking("PAUSED", 30)).resolves.toMatchObject({
      mode: "stopped",
      issue: "none",
      recovery: "none",
    })
    expect(locationMocks.stopLocationUpdatesAsync).toHaveBeenCalledWith(WORKDAY_LOCATION_TASK)
    expect(locationMocks.watchPositionAsync).not.toHaveBeenCalled()
  })
})
