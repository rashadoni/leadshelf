import type { FieldRoutePoint } from "./contracts"

export type RouteNavigationPlatform = "android" | "ios" | "other"

function validCoordinate(latitude: number | null, longitude: number | null): latitude is number {
  return (
    typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
  )
}

export function routeNavigationUrls(
  point: Pick<FieldRoutePoint, "customer" | "contact">,
  platform: RouteNavigationPlatform,
): string[] {
  const { latitude, longitude } = point.customer
  if (!validCoordinate(latitude, longitude)) return []
  const coordinates = String(latitude) + "," + String(longitude)
  const name = point.contact?.displayName ?? point.customer.name
  const query = encodeURIComponent(coordinates + "(" + name + ")")
  const browserFallback = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(coordinates)
  if (platform === "android") return ["geo:" + coordinates + "?q=" + query, browserFallback]
  if (platform === "ios") return ["http://maps.apple.com/?daddr=" + encodeURIComponent(coordinates), browserFallback]
  return [browserFallback]
}
