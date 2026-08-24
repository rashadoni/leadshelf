import * as Location from "expo-location"
import * as TaskManager from "expo-task-manager"
import type { PushResult } from "../sync/ports"
import { syncApi } from "../api/mobile-client"
import { enqueueFieldLocation, localStore } from "../db/local-store"
import { workdayLocationPayload } from "./workday-location"
import { IS_LEADDRIVE_FIELD } from "../config/mobile-variant"

export const WORKDAY_LOCATION_TASK = IS_LEADDRIVE_FIELD
  ? "leaddrive-field-workday-location-v1"
  : "leadshelf-workday-location-v1"
export type WorkdayTrackingMode = "background" | "foreground" | "denied" | "services_disabled" | "unavailable"
export type WorkdayTrackingIssue =
  | "none"
  | "services_disabled"
  | "foreground_permission_required"
  | "foreground_permission_blocked"
  | "background_permission_required"
  | "background_permission_blocked"
  | "background_unavailable"
  | "tracking_start_failed"
export type WorkdayTrackingRecovery = "none" | "request_permission" | "open_settings" | "retry_tracking"

export interface WorkdayTrackingState {
  mode: WorkdayTrackingMode | "stopped"
  issue: WorkdayTrackingIssue
  recovery: WorkdayTrackingRecovery
  observedAt: string
}

export function stoppedWorkdayTrackingState(): WorkdayTrackingState {
  return {
    mode: "stopped",
    issue: "none",
    recovery: "none",
    observedAt: new Date().toISOString(),
  }
}

let foregroundSubscription: Location.LocationSubscription | null = null

function trackingState(
  mode: WorkdayTrackingState["mode"],
  issue: WorkdayTrackingIssue = "none",
  recovery: WorkdayTrackingRecovery = "none",
): WorkdayTrackingState {
  return { mode, issue, recovery, observedAt: new Date().toISOString() }
}

function permissionRecovery(canAskAgain: boolean | undefined): WorkdayTrackingRecovery {
  return canAskAgain === false ? "open_settings" : "request_permission"
}

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
  options: { requestForegroundPermission?: boolean; requestBackgroundPermission?: boolean } = {},
): Promise<WorkdayTrackingState> {
  const requestForegroundPermission = options.requestForegroundPermission ?? true
  const requestBackgroundPermission = options.requestBackgroundPermission ?? true
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true)
  if (!servicesEnabled) {
    await stopWorkdayTracking()
    return trackingState("services_disabled", "services_disabled", "open_settings")
  }

  const foreground = await Location.getForegroundPermissionsAsync()
  const foregroundPermission = foreground.granted
    ? foreground
    : requestForegroundPermission
      ? await Location.requestForegroundPermissionsAsync()
      : foreground
  if (!foregroundPermission.granted) {
    await stopWorkdayTracking()
    return trackingState(
      "denied",
      foregroundPermission.canAskAgain === false
        ? "foreground_permission_blocked"
        : "foreground_permission_required",
      permissionRecovery(foregroundPermission.canAskAgain),
    )
  }

  await stopForegroundFallback()
  const interval = Math.max(15, Math.round(intervalSeconds || 30))
  const taskAvailable = await TaskManager.isAvailableAsync().catch(() => false)
  let foregroundIssue: WorkdayTrackingIssue = taskAvailable ? "none" : "background_unavailable"
  let foregroundRecovery: WorkdayTrackingRecovery = "none"
  if (taskAvailable) {
    const background = await Location.getBackgroundPermissionsAsync()
    const backgroundPermission = background.granted
      ? background
      : requestBackgroundPermission
        ? await Location.requestBackgroundPermissionsAsync()
        : background
    if (backgroundPermission.granted) {
      try {
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
        return trackingState("background")
      } catch {
        foregroundIssue = "tracking_start_failed"
        foregroundRecovery = "retry_tracking"
      }
    } else {
      foregroundIssue = backgroundPermission.canAskAgain === false
        ? "background_permission_blocked"
        : "background_permission_required"
      foregroundRecovery = permissionRecovery(backgroundPermission.canAskAgain)
    }
  }

  try {
    foregroundSubscription = await Location.watchPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: interval * 1_000,
      distanceInterval: 20,
    }, (location) => { void queueAndTryUpload(location) })
    return trackingState("foreground", foregroundIssue, foregroundRecovery)
  } catch {
    return trackingState("unavailable", "tracking_start_failed", "retry_tracking")
  }
}

export async function reconcileWorkdayTracking(
  status: "STARTED" | "PAUSED" | "COMPLETED" | null,
  intervalSeconds: number,
  enabled = true,
): Promise<WorkdayTrackingState> {
  if (status !== "STARTED" || !enabled) {
    await stopWorkdayTracking()
    return stoppedWorkdayTrackingState()
  }
  return startWorkdayTracking(intervalSeconds, {
    requestForegroundPermission: false,
    requestBackgroundPermission: false,
  })
}
