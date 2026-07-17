import type { FieldLocationPayload } from "../field/execution-outbox"

export type WorkdayLocationReading = {
  timestamp: number
  coords: {
    latitude: number
    longitude: number
    accuracy?: number | null
    speed?: number | null
    heading?: number | null
    altitude?: number | null
  }
}

function optionalNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export function workdayLocationPayload(reading: WorkdayLocationReading): FieldLocationPayload {
  const timestamp = Number.isFinite(reading.timestamp) ? reading.timestamp : Date.now()
  const latitude = reading.coords.latitude
  const longitude = reading.coords.longitude
  return {
    clientLocationId: `gps-${Math.round(timestamp)}-${latitude.toFixed(6)}-${longitude.toFixed(6)}`,
    latitude,
    longitude,
    accuracy: optionalNonNegative(reading.coords.accuracy),
    speed: optionalNonNegative(reading.coords.speed),
    heading: optionalNonNegative(reading.coords.heading),
    altitude: typeof reading.coords.altitude === "number" && Number.isFinite(reading.coords.altitude)
      ? reading.coords.altitude
      : null,
    battery: null,
    recordedAt: new Date(timestamp).toISOString(),
  }
}
