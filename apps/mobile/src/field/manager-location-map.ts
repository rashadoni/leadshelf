import type { FieldManagerLocationAgent, FieldManagerLocationPoint } from "./contracts"

export type ManagerLiveMapAgent = Pick<FieldManagerLocationAgent, "freshness" | "hasLiveLocation"> & {
  liveLocation: Pick<FieldManagerLocationPoint, "latitude" | "longitude"> | null
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
