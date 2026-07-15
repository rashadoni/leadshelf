import type {
  FieldLocationHistoryData,
  FieldWorkday,
  FieldWorkdayAction,
  FieldWorkdayData,
  FieldWorkdayEvent,
} from "./contracts"
import type { FieldLocationPayload } from "./execution-outbox"

type WorkdayEventDraft = {
  workdayId: string
  clientEventId: string
  occurredAt: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  note: string | null
}

function actions(status: FieldWorkday["status"] | null): FieldWorkdayAction[] {
  if (!status) return ["START"]
  if (status === "STARTED") return ["PAUSE", "FINISH"]
  if (status === "PAUSED") return ["RESUME", "FINISH"]
  return []
}

function secondsBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1_000))
}

export function emptyFieldWorkdayData(
  date: string,
  timezone: string,
  gpsIntervalSeconds = 30,
): FieldWorkdayData {
  return {
    date,
    today: date,
    timezone,
    gpsIntervalSeconds,
    workday: null,
    activeWorkday: null,
    availableActions: ["START"],
  }
}

export function applyOptimisticWorkdayAction(
  data: FieldWorkdayData,
  action: FieldWorkdayAction,
  draft: WorkdayEventDraft,
): FieldWorkdayData {
  const event: FieldWorkdayEvent = {
    id: draft.clientEventId,
    clientEventId: draft.clientEventId,
    type: action,
    occurredAt: draft.occurredAt,
    latitude: draft.latitude,
    longitude: draft.longitude,
    accuracy: draft.accuracy,
    note: draft.note,
    syncState: "PENDING",
  }

  if (action === "START") {
    if (data.workday) throw new Error("Workday already exists")
    const workday: FieldWorkday = {
      id: draft.workdayId,
      workDate: `${data.date}T00:00:00.000Z`,
      status: "STARTED",
      startedAt: draft.occurredAt,
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      workedSeconds: 0,
      startLatitude: draft.latitude,
      startLongitude: draft.longitude,
      endLatitude: null,
      endLongitude: null,
      availableActions: actions("STARTED"),
      events: [event],
      syncState: "PENDING",
    }
    return { ...data, workday, availableActions: workday.availableActions }
  }

  const current = data.workday
  if (!current || current.id !== draft.workdayId) throw new Error("Workday not found")
  if (!current.availableActions.includes(action)) throw new Error("Workday action is not available")

  let next: FieldWorkday
  if (action === "PAUSE") {
    next = {
      ...current,
      status: "PAUSED",
      pausedAt: draft.occurredAt,
      workedSeconds: Math.max(0, secondsBetween(current.startedAt, draft.occurredAt) - current.totalPausedSeconds),
    }
  } else if (action === "RESUME") {
    const pausedFor = current.pausedAt ? secondsBetween(current.pausedAt, draft.occurredAt) : 0
    next = {
      ...current,
      status: "STARTED",
      pausedAt: null,
      totalPausedSeconds: current.totalPausedSeconds + pausedFor,
    }
  } else {
    const activePause = current.status === "PAUSED" && current.pausedAt
      ? secondsBetween(current.pausedAt, draft.occurredAt)
      : 0
    const totalPausedSeconds = current.totalPausedSeconds + activePause
    next = {
      ...current,
      status: "COMPLETED",
      pausedAt: null,
      completedAt: draft.occurredAt,
      totalPausedSeconds,
      workedSeconds: Math.max(0, secondsBetween(current.startedAt, draft.occurredAt) - totalPausedSeconds),
      endLatitude: draft.latitude,
      endLongitude: draft.longitude,
    }
  }

  next = {
    ...next,
    events: [...next.events, event],
    availableActions: actions(next.status),
    syncState: "PENDING",
  }
  return { ...data, workday: next, availableActions: next.availableActions }
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (value: number) => value * Math.PI / 180
  const deltaLat = radians(lat2 - lat1)
  const deltaLng = radians(lng2 - lng1)
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function appendOptimisticFieldLocation(
  data: FieldLocationHistoryData,
  payload: FieldLocationPayload,
): FieldLocationHistoryData {
  if (data.locations.some((location) => location.clientLocationId === payload.clientLocationId)) return data
  const previous = data.locations.at(-1)
  const increment = previous
    ? distanceMeters(previous.latitude, previous.longitude, payload.latitude, payload.longitude)
    : 0
  return {
    ...data,
    distanceMeters: Math.round(data.distanceMeters + increment),
    locations: [...data.locations, {
      id: payload.clientLocationId,
      ...payload,
      isMoving: (payload.speed ?? 0) > 1,
      syncState: "PENDING",
    }],
  }
}
