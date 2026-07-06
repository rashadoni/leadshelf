import { distanceMeters, type GeoPoint } from "../field-force/geofence.ts"

export interface PhotoProofMetadataInput {
  exif: unknown
  takenAt: Date
  receivedAt?: Date
  expectedUserId?: string | null
  expectedTaskId?: string | null
  expectedStoreId?: string | null
  expectedStoreLocation?: GeoPoint | null
  maxGpsDistanceM?: number
  maxTimestampDriftMs?: number
}

export interface PhotoProofMetadataResult {
  status: "PASS" | "REVIEW"
  hasCaptureProof: boolean
  capturedAt: string | null
  capture: {
    scenarioId: string | null
    stepId: string | null
    stepKind: string | null
    required: boolean | null
    mediaKind: string | null
  }
  gps: {
    status: "MATCHED" | "MISSING" | "OUTSIDE" | "UNKNOWN"
    latitude: number | null
    longitude: number | null
    distanceM: number | null
    limitM: number
  }
  identity: {
    userMatched: boolean | null
    taskMatched: boolean | null
    storeMatched: boolean | null
  }
  issues: string[]
}

const DEFAULT_GPS_LIMIT_M = 50
const DEFAULT_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000
const ACCEPTED_SOFTWARE = new Set(["LeadShelf Mobile", "LeadShelf Field Mobile"])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function numberValue(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function parseImageDescription(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string" || !value.trim()) return {}
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

function matchingId(actual: string | null, expected: string | null | undefined): boolean | null {
  if (!expected) return null
  if (!actual) return false
  return actual === expected
}

function gpsFromExif(exif: Record<string, unknown>): { latitude: number | null; longitude: number | null } {
  const nestedGps = asRecord(exif.gps)
  const latitude = numberValue(exif, ["GPSLatitude", "gpsLatitude", "latitude", "lat"]) ?? numberValue(nestedGps, ["latitude", "lat"])
  const longitude =
    numberValue(exif, ["GPSLongitude", "gpsLongitude", "longitude", "lng", "lon"]) ??
    numberValue(nestedGps, ["longitude", "lng", "lon"])
  return { latitude, longitude }
}

export function evaluatePhotoProofMetadata(input: PhotoProofMetadataInput): PhotoProofMetadataResult {
  const receivedAt = input.receivedAt ?? new Date()
  const gpsLimitM = input.maxGpsDistanceM ?? DEFAULT_GPS_LIMIT_M
  const timestampDriftMs = input.maxTimestampDriftMs ?? DEFAULT_TIMESTAMP_DRIFT_MS
  const issues: string[] = []

  const exif = asRecord(input.exif)
  if (Object.keys(exif).length === 0) {
    return {
      status: "REVIEW",
      hasCaptureProof: false,
      capturedAt: null,
      capture: { scenarioId: null, stepId: null, stepKind: null, required: null, mediaKind: null },
      gps: { status: "UNKNOWN", latitude: null, longitude: null, distanceM: null, limitM: gpsLimitM },
      identity: { userMatched: input.expectedUserId ? false : null, taskMatched: input.expectedTaskId ? false : null, storeMatched: input.expectedStoreId ? false : null },
      issues: ["missing_exif"],
    }
  }

  const description = parseImageDescription(exif.ImageDescription ?? exif.imageDescription)
  if (Object.keys(description).length === 0) issues.push("missing_image_description")

  const software = stringValue(exif, ["Software", "software"])
  if (!software || !ACCEPTED_SOFTWARE.has(software)) issues.push("invalid_capture_software")

  const captureStep = asRecord(description.captureStep)
  const captureScenario = asRecord(description.captureScenario)
  const legacyWatermark = description.watermarked === true || exif.watermarked === true
  const hasCaptureProof = !!software && ACCEPTED_SOFTWARE.has(software) && (Object.keys(description).length > 0 || legacyWatermark)

  const capturedAt =
    stringValue(exif, ["DateTimeOriginal", "dateTimeOriginal", "capturedAt", "takenAt", "watermarkedAt"]) ??
    stringValue(description, ["capturedAt", "takenAt", "watermarkedAt"])
  if (!capturedAt) {
    issues.push("missing_capture_timestamp")
  } else {
    const parsed = new Date(capturedAt)
    if (Number.isNaN(parsed.getTime())) {
      issues.push("invalid_capture_timestamp")
    } else {
      const driftFromTakenAt = Math.abs(parsed.getTime() - input.takenAt.getTime())
      const driftFromReceivedAt = Math.abs(receivedAt.getTime() - parsed.getTime())
      if (driftFromTakenAt > timestampDriftMs || driftFromReceivedAt > 24 * 60 * 60 * 1000) {
        issues.push("capture_timestamp_drift")
      }
    }
  }

  const describedUserId = stringValue(description, ["userId", "agentId"])
  const describedTaskId = stringValue(description, ["taskId", "visitId"])
  const describedStoreId = stringValue(description, ["storeId", "customerId"])
  const userMatched = matchingId(describedUserId, input.expectedUserId)
  const taskMatched = matchingId(describedTaskId, input.expectedTaskId)
  const storeMatched = matchingId(describedStoreId, input.expectedStoreId)
  if (userMatched === false) issues.push("capture_user_mismatch")
  if (taskMatched === false) issues.push("capture_task_mismatch")
  if (storeMatched === false) issues.push("capture_store_mismatch")

  const { latitude, longitude } = gpsFromExif(exif)
  let gpsStatus: PhotoProofMetadataResult["gps"]["status"] = "UNKNOWN"
  let distanceM: number | null = null
  if (latitude == null || longitude == null) {
    gpsStatus = "MISSING"
    issues.push("gps_unavailable")
  } else if (input.expectedStoreLocation) {
    distanceM = distanceMeters(input.expectedStoreLocation, { latitude, longitude })
    gpsStatus = distanceM > gpsLimitM ? "OUTSIDE" : "MATCHED"
    if (gpsStatus === "OUTSIDE") issues.push("gps_outside_store_radius")
  } else {
    gpsStatus = "UNKNOWN"
  }

  const blockingIssues = issues.filter((issue) => issue !== "gps_unavailable")
  return {
    status: blockingIssues.length === 0 ? "PASS" : "REVIEW",
    hasCaptureProof,
    capturedAt: capturedAt ?? null,
    capture: {
      scenarioId: stringValue(captureScenario, ["id", "scenarioId"]) ?? stringValue(description, ["scenarioId"]),
      stepId: stringValue(captureStep, ["id", "stepId"]) ?? stringValue(description, ["stepId"]),
      stepKind: stringValue(captureStep, ["kind", "stepKind"]) ?? stringValue(description, ["stepKind"]),
      required: typeof captureStep.required === "boolean" ? captureStep.required : null,
      mediaKind: stringValue(captureStep, ["mediaKind"]) ?? stringValue(description, ["mediaKind"]),
    },
    gps: { status: gpsStatus, latitude, longitude, distanceM, limitM: gpsLimitM },
    identity: { userMatched, taskMatched, storeMatched },
    issues,
  }
}
