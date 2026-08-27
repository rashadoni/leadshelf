import { describe, expect, it } from "vitest"
import {
  managerLiveMapUrl,
  managerTeamMapPoint,
  managerTeamMapViewport,
  type ManagerLiveMapAgent,
} from "./manager-location-map"

const liveAgent: ManagerLiveMapAgent = {
  freshness: "ONLINE",
  hasLiveLocation: true,
  liveLocation: { latitude: 40.4093, longitude: 49.8671 },
}

describe("manager live map URL", () => {
  it("keeps the existing Apple Maps and Google Maps links for a live point", () => {
    expect(managerLiveMapUrl(liveAgent, "ios")).toBe("https://maps.apple.com/?q=40.4093%2C49.8671")
    expect(managerLiveMapUrl(liveAgent, "android")).toBe("https://www.google.com/maps/search/?api=1&query=40.4093%2C49.8671")
  })

  it("does not create a map action for delayed, missing, or invalid live evidence", () => {
    expect(managerLiveMapUrl({ ...liveAgent, freshness: "DELAYED", hasLiveLocation: false, liveLocation: null }, "ios")).toBeNull()
    expect(managerLiveMapUrl({ ...liveAgent, liveLocation: null }, "android")).toBeNull()
    expect(managerLiveMapUrl({ ...liveAgent, liveLocation: { latitude: 91, longitude: 49.8671 } }, "ios")).toBeNull()
  })

  it("keeps live and last-known team markers semantically distinct", () => {
    expect(managerTeamMapPoint({
      id: "agent-live",
      name: "Aysel",
      freshness: "ONLINE",
      hasLiveLocation: true,
      liveLocation: { latitude: 40.4093, longitude: 49.8671, recordedAt: "2026-08-27T10:00:00Z", accuracy: 8 },
      lastKnownLocation: null,
    })).toMatchObject({ agentId: "agent-live", evidence: "LIVE", latitude: 40.4093, longitude: 49.8671 })

    expect(managerTeamMapPoint({
      id: "agent-stale",
      name: "Murad",
      freshness: "STALE",
      hasLiveLocation: false,
      liveLocation: null,
      lastKnownLocation: { latitude: 40.401, longitude: 49.86, recordedAt: "2026-08-26T10:00:00Z", accuracy: null },
    })).toMatchObject({ agentId: "agent-stale", evidence: "LAST_KNOWN", freshness: "STALE" })

    expect(managerTeamMapPoint({
      id: "agent-missing",
      name: "Leyla",
      freshness: "NO_LOCATION",
      hasLiveLocation: false,
      liveLocation: null,
      lastKnownLocation: null,
    })).toBeNull()
  })

  it("derives a bounded first viewport from actual loaded coordinates", () => {
    const viewport = managerTeamMapViewport([
      { agentId: "a", name: "A", freshness: "ONLINE", evidence: "LIVE", latitude: 40.40, longitude: 49.85 },
      { agentId: "b", name: "B", freshness: "DELAYED", evidence: "LAST_KNOWN", latitude: 40.42, longitude: 49.89 },
    ])
    expect(viewport?.center[0]).toBeCloseTo(49.87)
    expect(viewport?.center[1]).toBeCloseTo(40.41)
    expect(viewport?.zoom).toBe(11)
    expect(managerTeamMapViewport([])).toBeNull()
  })
})
