import { describe, expect, it } from "vitest"
import { buildProofExifPayload } from "./proof-metadata"

describe("mobile proof metadata", () => {
  it("builds LeadShelf EXIF-like payload accepted by backend proof validator", () => {
    const payload = buildProofExifPayload({
      takenAt: "2026-07-06T09:00:00.000Z",
      taskId: "task-a",
      storeId: "store-a",
      storeName: "Аптека 1",
      userId: "user-a",
      locationHint: "Стеллаж 1",
      appVersion: "1.0.0",
      deviceLocation: {
        latitude: 40.40931,
        longitude: 49.86709,
        accuracyM: 12,
        recordedAt: "2026-07-06T08:59:58.000Z",
      },
    })
    const description = JSON.parse(payload.ImageDescription)

    expect(payload).toMatchObject({
      DateTimeOriginal: "2026-07-06T09:00:00.000Z",
      Make: "LeadShelf",
      Model: "1.0.0",
      Software: "LeadShelf Mobile",
      watermarked: true,
      GPSLatitude: 40.40931,
      GPSLongitude: 49.86709,
    })
    expect(description).toMatchObject({
      userId: "user-a",
      taskId: "task-a",
      storeId: "store-a",
      watermarked: true,
      watermarkMode: "camera_overlay",
      gpsUnavailable: false,
      gpsAccuracyM: 12,
    })
  })
})
