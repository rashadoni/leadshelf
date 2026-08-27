import type { FieldManagerLocationAgent, FieldManagerLocationPoint } from "./contracts"

export type ManagerLiveMapAgent = Pick<FieldManagerLocationAgent, "freshness" | "hasLiveLocation"> & {
  liveLocation: Pick<FieldManagerLocationPoint, "latitude" | "longitude"> | null
}

export type ManagerTeamMapAgent = Pick<
  FieldManagerLocationAgent,
  "id" | "name" | "freshness" | "hasLiveLocation" | "liveLocation" | "lastKnownLocation"
>

export type ManagerTeamMapPoint = {
  agentId: string
  name: string
  freshness: FieldManagerLocationAgent["freshness"]
  evidence: "LIVE" | "LAST_KNOWN"
  latitude: number
  longitude: number
}

export type ManagerTeamMapViewport = {
  center: [longitude: number, latitude: number]
  zoom: number
}

function hasValidCoordinates(location: ManagerLiveMapAgent["liveLocation"]): location is NonNullable<ManagerLiveMapAgent["liveLocation"]> {
  return Boolean(
    location
    && Number.isFinite(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180,
  )
}

/**
 * Keep the map truthful: ONLINE may use only the server-labelled live point;
 * delayed/stale users may be displayed only as explicitly last-known evidence.
 */
export function managerTeamMapPoint(agent: ManagerTeamMapAgent): ManagerTeamMapPoint | null {
  const live = agent.freshness === "ONLINE" && agent.hasLiveLocation && hasValidCoordinates(agent.liveLocation)
    ? agent.liveLocation
    : null
  const lastKnown = !live && agent.freshness !== "NO_LOCATION" && hasValidCoordinates(agent.lastKnownLocation)
    ? agent.lastKnownLocation
    : null
  const location = live ?? lastKnown
  if (!location) return null
  return {
    agentId: agent.id,
    name: agent.name,
    freshness: agent.freshness,
    evidence: live ? "LIVE" : "LAST_KNOWN",
    latitude: location.latitude,
    longitude: location.longitude,
  }
}

/** A deterministic first frame that includes the loaded team without fake points. */
export function managerTeamMapViewport(points: readonly ManagerTeamMapPoint[]): ManagerTeamMapViewport | null {
  if (points.length === 0) return null
  const latitudes = points.map((point) => point.latitude)
  const longitudes = points.map((point) => point.longitude)
  const south = Math.min(...latitudes)
  const north = Math.max(...latitudes)
  const west = Math.min(...longitudes)
  const east = Math.max(...longitudes)
  const span = Math.max(north - south, east - west)
  const zoom = span <= 0.002 ? 15 : span <= 0.01 ? 13 : span <= 0.05 ? 11 : span <= 0.2 ? 9 : span <= 1 ? 7 : 5
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom,
  }
}

/**
 * The manager location view may only open a map for server-labelled live
 * evidence. Delayed and last-known points remain informational and never get
 * promoted to a map action on the client.
 */
export function managerLiveMapUrl(agent: ManagerLiveMapAgent, platform: string): string | null {
  const location = agent.liveLocation
  if (agent.freshness !== "ONLINE" || !agent.hasLiveLocation || !hasValidCoordinates(location)) {
    return null
  }
  const query = String(location.latitude) + "," + String(location.longitude)
  return platform === "ios"
    ? "https://maps.apple.com/?q=" + encodeURIComponent(query)
    : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query)
}
