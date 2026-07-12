import * as Location from "expo-location"

export interface DeviceLocation {
  latitude: number
  longitude: number
  accuracyM: number | null
  recordedAt: string
}

const LAST_KNOWN_MAX_AGE_MS = 30_000
const LAST_KNOWN_REQUIRED_ACCURACY_M = 100

function toDeviceLocation(reading: Location.LocationObject): DeviceLocation {
  return {
    latitude: reading.coords.latitude,
    longitude: reading.coords.longitude,
    accuracyM: reading.coords.accuracy ?? null,
    recordedAt: new Date(reading.timestamp).toISOString(),
  }
}

export async function getCurrentDeviceLocation(): Promise<DeviceLocation | null> {
  const existing = await Location.getForegroundPermissionsAsync()
  const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync()
  if (!permission.granted) return null

  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracy: LAST_KNOWN_REQUIRED_ACCURACY_M,
  }).catch(() => null)
  if (lastKnown) return toDeviceLocation(lastKnown)

  const reading = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  return toDeviceLocation(reading)
}
