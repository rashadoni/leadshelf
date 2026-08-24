import { describe, expect, it } from "vitest"
import { routeNavigationUrls } from "./route-navigation"

const point = {
  customer: {
    latitude: 40.4093,
    longitude: 49.8671,
    name: "Baku Clinic",
  },
  contact: null,
} as any

describe("route navigation URLs", () => {
  it("uses a native map scheme first and an HTTPS fallback", () => {
    expect(routeNavigationUrls(point, "android")).toEqual([
      "geo:40.4093,49.8671?q=40.4093%2C49.8671(Baku%20Clinic)",
      "https://www.google.com/maps/dir/?api=1&destination=40.4093%2C49.8671",
    ])
    expect(routeNavigationUrls(point, "ios")[0]).toBe("http://maps.apple.com/?daddr=40.4093%2C49.8671")
  })

  it("does not create a map action without valid coordinates", () => {
    expect(routeNavigationUrls({ ...point, customer: { ...point.customer, latitude: null } }, "android")).toEqual([])
    expect(routeNavigationUrls({ ...point, customer: { ...point.customer, longitude: 190 } }, "ios")).toEqual([])
  })
})
