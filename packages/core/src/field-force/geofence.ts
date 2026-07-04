export interface GeoPoint {
  latitude: number
  longitude: number
}

export interface GeofenceResult {
  distanceM: number | null
  limitM: number
  outside: boolean
}

const EARTH_RADIUS_M = 6_371_000

function toRad(value: number): number {
  return (value * Math.PI) / 180
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)))
}

export function evaluateVisitGeofence({
  store,
  checkIn,
  limitM = 150,
}: {
  store: GeoPoint | null
  checkIn: GeoPoint
  limitM?: number
}): GeofenceResult {
  if (!store) return { distanceM: null, limitM, outside: false }
  const distanceM = distanceMeters(store, checkIn)
  return { distanceM, limitM, outside: distanceM > limitM }
}
