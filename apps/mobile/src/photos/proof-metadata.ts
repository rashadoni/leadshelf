export interface ProofMetadataInput {
  takenAt: string
  taskId: string
  storeId: string
  storeName?: string | null
  userId?: string | null
  locationHint?: string | null
  appVersion?: string | null
  deviceLocation?: {
    latitude: number
    longitude: number
    accuracyM?: number | null
    recordedAt?: string | null
  } | null
}

export interface ProofExifPayload {
  DateTimeOriginal: string
  Make: "LeadShelf"
  Model: string
  Software: "LeadShelf Mobile"
  ImageDescription: string
  watermarked: true
  GPSLatitude?: number
  GPSLongitude?: number
  gps?: {
    latitude: number
    longitude: number
    accuracyM: number | null
    recordedAt: string | null
  }
}

export function buildProofExifPayload(input: ProofMetadataInput): ProofExifPayload {
  const description = {
    userId: input.userId ?? null,
    taskId: input.taskId,
    storeId: input.storeId,
    storeName: input.storeName ?? null,
    locationHint: input.locationHint ?? null,
    watermarked: true,
    watermarkedAt: input.takenAt,
    watermarkMode: "camera_overlay",
    gpsUnavailable: !input.deviceLocation,
    gpsAccuracyM: input.deviceLocation?.accuracyM ?? null,
    gpsRecordedAt: input.deviceLocation?.recordedAt ?? null,
  }
  const payload: ProofExifPayload = {
    DateTimeOriginal: input.takenAt,
    Make: "LeadShelf",
    Model: input.appVersion ?? "mobile-app",
    Software: "LeadShelf Mobile",
    ImageDescription: JSON.stringify(description),
    watermarked: true,
  }
  if (!input.deviceLocation) return payload
  return {
    ...payload,
    GPSLatitude: input.deviceLocation.latitude,
    GPSLongitude: input.deviceLocation.longitude,
    gps: {
      latitude: input.deviceLocation.latitude,
      longitude: input.deviceLocation.longitude,
      accuracyM: input.deviceLocation.accuracyM ?? null,
      recordedAt: input.deviceLocation.recordedAt ?? null,
    },
  }
}

export function buildProofExifJson(input: ProofMetadataInput): string {
  return JSON.stringify(buildProofExifPayload(input))
}
