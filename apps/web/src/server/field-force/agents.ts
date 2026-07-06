import { DEFAULT_FIELD_FORCE_SETTINGS, offlineCutoffFor, type FieldForceSettingsState } from "./settings"

export type FieldAgentStatus = "CHECKED_IN" | "ON_ROAD" | "LATE" | "OFFLINE"

interface FieldForceVisit {
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | string
  createdAt?: Date | string | null
  checkInAt?: Date | string | null
  checkOutAt?: Date | string | null
  store?: { id?: string; name?: string | null; code?: string | null } | null
}

interface FieldForceStop {
  plannedAt?: Date | string | null
  visits?: FieldForceVisit[] | null
}

interface FieldForceRoute {
  stops?: FieldForceStop[] | null
}

interface FieldForceLocation {
  latitude: number
  longitude: number
  accuracyM?: number | null
  recordedAt: Date
}

interface FieldForceAgentRecord {
  id: string
  userId: string
  phone?: string | null
  employeeCode?: string | null
  teamId?: string | null
  user: {
    id?: string
    name: string
    email?: string | null
    role?: string | null
    isActive?: boolean | null
  }
  team?: { id: string; name: string } | null
  locations?: FieldForceLocation[] | null
  routes?: FieldForceRoute[] | null
  visits?: FieldForceVisit[] | null
}

export function completedStopsCount(stops: FieldForceStop[]) {
  return stops.filter((stop) => stop.visits?.some((visit) => visit.status === "COMPLETED")).length
}

export function routeCompletionFor(stops: FieldForceStop[]) {
  if (stops.length === 0) return 0
  return Math.round((completedStopsCount(stops) / stops.length) * 100)
}

export function fieldStatusFor({
  latestLocation,
  activeVisit,
  plannedLateStop,
  now,
  userIsActive,
  settings = DEFAULT_FIELD_FORCE_SETTINGS,
}: {
  latestLocation: FieldForceLocation | null
  activeVisit: FieldForceVisit | null
  plannedLateStop: FieldForceStop | null
  now: Date
  userIsActive: boolean
  settings?: Pick<FieldForceSettingsState, "offlineAfterMinutes">
}): { isOnline: boolean; fieldStatus: FieldAgentStatus } {
  const isOnline = Boolean(
    latestLocation &&
      latestLocation.recordedAt >= offlineCutoffFor(now, settings) &&
      userIsActive,
  )
  const fieldStatus: FieldAgentStatus = !isOnline
    ? "OFFLINE"
    : activeVisit
      ? "CHECKED_IN"
      : plannedLateStop
        ? "LATE"
        : "ON_ROAD"
  return { isOnline, fieldStatus }
}

export function scoreFieldForceAgent(agent: {
  completedVisitsToday: number
  routeCompletion: number
  isOnline: boolean
  fieldStatus: FieldAgentStatus
}) {
  return (
    agent.completedVisitsToday * 20 +
    agent.routeCompletion +
    (agent.isOnline ? 10 : 0) -
    (agent.fieldStatus === "LATE" ? 20 : 0)
  )
}

export function shapeFieldForceAgent(
  agent: FieldForceAgentRecord,
  now: Date,
  settings: Pick<FieldForceSettingsState, "offlineAfterMinutes"> = DEFAULT_FIELD_FORCE_SETTINGS,
) {
  const latestLocation = agent.locations?.[0] ?? null
  const routeStops = (agent.routes ?? []).flatMap((route) => route.stops ?? [])
  const routeCompletion = routeCompletionFor(routeStops)
  const visits = agent.visits ?? []
  const activeVisit = visits.find((visit) => visit.status === "IN_PROGRESS") ?? null
  const plannedLateStop =
    routeStops.find(
      (stop) =>
        stop.plannedAt &&
        new Date(stop.plannedAt) < now &&
        !stop.visits?.some((visit) => visit.status === "COMPLETED" || visit.status === "SKIPPED"),
    ) ?? null
  const { isOnline, fieldStatus } = fieldStatusFor({
    latestLocation,
    activeVisit,
    plannedLateStop,
    now,
    userIsActive: agent.user.isActive ?? true,
    settings,
  })
  const completedVisitsToday = visits.filter((visit) => visit.status === "COMPLETED").length

  return {
    id: agent.id,
    agentId: agent.id,
    userId: agent.userId,
    name: agent.user.name,
    email: agent.user.email ?? null,
    role: agent.user.role ?? null,
    status: agent.user.isActive === false ? "INACTIVE" : "ACTIVE",
    phone: agent.phone ?? null,
    employeeCode: agent.employeeCode ?? null,
    teamId: agent.teamId ?? null,
    team: agent.team ? { id: agent.team.id, name: agent.team.name } : null,
    isOnline,
    fieldStatus,
    routeCompletion,
    visitsToday: visits.length,
    completedVisitsToday,
    activeRoutes: agent.routes?.length ?? 0,
    routeStopsToday: routeStops.length,
    lastCustomer: visits[0]?.store?.name ?? null,
    lastSeenAt: latestLocation?.recordedAt ?? null,
    latitude: latestLocation?.latitude ?? null,
    longitude: latestLocation?.longitude ?? null,
    accuracy: latestLocation?.accuracyM ?? null,
  }
}

export function shapeFieldForceLocationAgent(
  agent: FieldForceAgentRecord,
  now: Date,
  settings: Pick<FieldForceSettingsState, "offlineAfterMinutes"> = DEFAULT_FIELD_FORCE_SETTINGS,
) {
  const shaped = shapeFieldForceAgent(agent, now, settings)
  return {
    agentId: agent.id,
    name: agent.user.name,
    isOnline: shaped.isOnline,
    lastSeenAt: shaped.lastSeenAt,
    fieldStatus: shaped.fieldStatus,
    routeCompletion: shaped.routeCompletion,
    ...(shaped.latitude != null && shaped.longitude != null
      ? {
          latitude: shaped.latitude,
          longitude: shaped.longitude,
          accuracy: shaped.accuracy,
          speed: null,
          heading: null,
          battery: null,
          isMoving: false,
          recordedAt: shaped.lastSeenAt,
        }
      : {}),
  }
}
