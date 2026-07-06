import { describe, expect, it } from "vitest"
import { evaluatePhotoProofMetadata } from "./watermark"

const baseInput = {
  takenAt: new Date("2026-07-06T09:00:00.000Z"),
  receivedAt: new Date("2026-07-06T09:00:20.000Z"),
  expectedUserId: "user-a",
  expectedTaskId: "task-a",
  expectedStoreId: "store-a",
  expectedStoreLocation: { latitude: 40.4093, longitude: 49.8671 },
}

function validExif(overrides: Record<string, unknown> = {}) {
  return {
    DateTimeOriginal: "2026-07-06T09:00:00.000Z",
    GPSLatitude: 40.40931,
    GPSLongitude: 49.86709,
    Make: "LeadShelf",
    Model: "1.0.0",
    Software: "LeadShelf Mobile",
    ImageDescription: JSON.stringify({
      userId: "user-a",
      taskId: "task-a",
      storeId: "store-a",
      watermarked: true,
    }),
    ...overrides,
  }
}

describe("photo proof watermark metadata", () => {
  it("passes valid LeadShelf watermark metadata", () => {
    const result = evaluatePhotoProofMetadata({ ...baseInput, exif: validExif() })

    expect(result.status).toBe("PASS")
    expect(result.hasWatermark).toBe(true)
    expect(result.gps.status).toBe("MATCHED")
    expect(result.identity).toEqual({ userMatched: true, taskMatched: true, storeMatched: true })
    expect(result.issues).toEqual([])
  })

  it("sends missing EXIF to review", () => {
    const result = evaluatePhotoProofMetadata({ ...baseInput, exif: null })

    expect(result.status).toBe("REVIEW")
    expect(result.hasWatermark).toBe(false)
    expect(result.issues).toContain("missing_exif")
  })

  it("detects invalid software and identity mismatch", () => {
    const result = evaluatePhotoProofMetadata({
      ...baseInput,
      exif: validExif({
        Software: "Other Camera",
        ImageDescription: JSON.stringify({
          userId: "other-user",
          taskId: "task-a",
          storeId: "store-a",
          watermarked: true,
        }),
      }),
    })

    expect(result.status).toBe("REVIEW")
    expect(result.issues).toEqual(expect.arrayContaining(["invalid_watermark_software", "watermark_user_mismatch"]))
  })

  it("detects GPS outside the expected store radius", () => {
    const result = evaluatePhotoProofMetadata({
      ...baseInput,
      exif: validExif({ GPSLatitude: 40.5, GPSLongitude: 50.0 }),
    })

    expect(result.status).toBe("REVIEW")
    expect(result.gps.status).toBe("OUTSIDE")
    expect(result.gps.distanceM).toBeGreaterThan(50)
    expect(result.issues).toContain("gps_outside_store_radius")
  })

  it("allows GPS unavailable as a non-blocking proof issue", () => {
    const result = evaluatePhotoProofMetadata({
      ...baseInput,
      exif: validExif({ GPSLatitude: undefined, GPSLongitude: undefined }),
    })

    expect(result.status).toBe("PASS")
    expect(result.gps.status).toBe("MISSING")
    expect(result.issues).toEqual(["gps_unavailable"])
  })
})
