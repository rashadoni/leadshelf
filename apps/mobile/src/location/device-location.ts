import * as Location from "expo-location"

export interface DeviceLocation {
  latitude: number
  longitude: number
  accuracyM: number | null
  recordedAt: string
}

export async function getCurrentDeviceLocation(): Promise<DeviceLocation | null> {
  const existing = await Location.getForegroundPermissionsAsync()
  const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync()
  if (!permission.granted) return null

  const reading = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  return {
    latitude: reading.coords.latitude,
    longitude: reading.coords.longitude,
    accuracyM: reading.coords.accuracy ?? null,
    recordedAt: new Date(reading.timestamp).toISOString(),
  }
}
