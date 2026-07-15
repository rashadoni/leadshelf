import * as Location from "expo-location"
import * as TaskManager from "expo-task-manager"
import type { PushResult } from "../sync/ports"
import { syncApi } from "../api/mobile-client"
import { enqueueFieldLocation, localStore } from "../db/local-store"
import { workdayLocationPayload } from "./workday-location"

export const WORKDAY_LOCATION_TASK = "leadshelf-workday-location-v1"
export type WorkdayTrackingMode = "background" | "foreground" | "denied"

let foregroundSubscription: Location.LocationSubscription | null = null

function localStatus(result: PushResult): "applied" | "conflict" | "rejected" {
  if (result.status === "applied" || result.status === "already_applied") return "applied"
  return result.status === "conflict" ? "conflict" : "rejected"
}

async function queueAndTryUpload(reading: Location.LocationObject): Promise<void> {
  const payload = workdayLocationPayload(reading)
  const queued = enqueueFieldLocation(payload)
  try {
    const response = await syncApi.push([{
      clientOpId: queued.clientOpId,
      clientCreatedAt: payload.recordedAt,
      kind: "field.location",
      payload,
    }])
    const result = response.results.find((item) => item.clientOpId === queued.clientOpId)
    if (result) await localStore.markOutbox(result.clientOpId, localStatus(result), result.detail)
  } catch {
    // Durable outbox owns retry. Background tracking must never crash because
    // the phone is offline or the OS suspended network access.
  }
}

if (!TaskManager.isTaskDefined(WORKDAY_LOCATION_TASK)) {
  TaskManager.defineTask(WORKDAY_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data || typeof data !== "object") return
    const locations = (data as { locations?: Location.LocationObject[] }).locations
    if (!Array.isArray(locations)) return
    for (const location of locations) await queueAndTryUpload(location)
  })
}

async function stopForegroundFallback(): Promise<void> {
  foregroundSubscription?.remove()
  foregroundSubscription = null
}

export async function stopWorkdayTracking(): Promise<void> {
  await stopForegroundFallback()
  const backgroundRunning = await Location.hasStartedLocationUpdatesAsync(WORKDAY_LOCATION_TASK).catch(() => false)
  if (backgroundRunning) await Location.stopLocationUpdatesAsync(WORKDAY_LOCATION_TASK).catch(() => {})
}

export async function startWorkdayTracking(
  intervalSeconds: number,
  requestBackgroundPermission = true,
): Promise<WorkdayTrackingMode> {
  const foreground = await Location.getForegroundPermissionsAsync()
  const foregroundPermission = foreground.granted
    ? foreground
    : await Location.requestForegroundPermissionsAsync()
  if (!foregroundPermission.granted) return "denied"

  await stopForegroundFallback()
  const interval = Math.max(15, Math.round(intervalSeconds || 30))
  const taskAvailable = await TaskManager.isAvailableAsync().catch(() => false)
  if (taskAvailable) {
    const background = await Location.getBackgroundPermissionsAsync()
    const backgroundPermission = background.granted
      ? background
      : requestBackgroundPermission
        ? await Location.requestBackgroundPermissionsAsync()
        : background
    if (backgroundPermission.granted) {
      const running = await Location.hasStartedLocationUpdatesAsync(WORKDAY_LOCATION_TASK).catch(() => false)
      if (!running) {
        await Location.startLocationUpdatesAsync(WORKDAY_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: interval * 1_000,
          distanceInterval: 20,
          deferredUpdatesInterval: interval * 1_000,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          activityType: Location.ActivityType.OtherNavigation,
          foregroundService: {
            notificationTitle: "LeadDrive Field",
            notificationBody: "Active workday · GPS tracking",
            killServiceOnDestroy: false,
          },
        })
      }
      return "background"
    }
  }

  foregroundSubscription = await Location.watchPositionAsync({
    accuracy: Location.Accuracy.Balanced,
    timeInterval: interval * 1_000,
    distanceInterval: 20,
  }, (location) => { void queueAndTryUpload(location) })
  return "foreground"
}

export async function reconcileWorkdayTracking(
  status: "STARTED" | "PAUSED" | "COMPLETED" | null,
  intervalSeconds: number,
): Promise<WorkdayTrackingMode | "stopped"> {
  if (status !== "STARTED") {
    await stopWorkdayTracking()
    return "stopped"
  }
  const foreground = await Location.getForegroundPermissionsAsync()
  if (!foreground.granted) return "denied"
  return startWorkdayTracking(intervalSeconds, false)
}
