import { describe, expect, it } from "vitest"
import { managerLiveMapUrl, type ManagerLiveMapAgent } from "./manager-location-map"

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
})
