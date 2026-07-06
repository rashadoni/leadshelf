import type { CaptureStepMetadata } from "./capture-scenario"

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
  captureStep?: CaptureStepMetadata | null
}

export interface ProofExifPayload {
  DateTimeOriginal: string
  Make: "LeadShelf"
  Model: string
  Software: "LeadShelf Mobile"
  ImageDescription: string
  capturedBy: "LeadShelf Mobile"
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
    capturedAt: input.takenAt,
    captureMode: "guided_shelf_proof",
    captureScenario: input.captureStep
      ? {
          id: input.captureStep.scenarioId,
          version: 1,
        }
      : null,
    captureStep: input.captureStep
      ? {
          id: input.captureStep.stepId,
          kind: input.captureStep.stepKind,
          required: input.captureStep.required,
          sequence: input.captureStep.sequence,
          mediaKind: input.captureStep.mediaKind,
          minDurationSeconds: input.captureStep.minDurationSeconds ?? null,
          maxDurationSeconds: input.captureStep.maxDurationSeconds ?? null,
        }
      : null,
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
    capturedBy: "LeadShelf Mobile",
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
