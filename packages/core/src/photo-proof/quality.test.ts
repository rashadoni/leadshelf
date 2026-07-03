import { describe, expect, it } from "vitest"
import { evaluatePhotoQuality, readImageDimensions } from "./quality.ts"

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(120 * 1024)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    0x00,
    0x48,
    0x00,
    0x48,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ])
}

describe("photo quality", () => {
  it("reads PNG dimensions", () => {
    expect(readImageDimensions(pngHeader(1440, 1080), "image/png")).toEqual({ width: 1440, height: 1080 })
  })

  it("reads JPEG dimensions", () => {
    expect(readImageDimensions(jpegHeader(1920, 1080), "image/jpeg")).toEqual({ width: 1920, height: 1080 })
  })

  it("marks low resolution uploads for review", () => {
    const result = evaluatePhotoQuality({
      bytes: pngHeader(640, 480),
      mimeType: "image/png",
      takenAt: new Date("2026-07-03T10:00:00.000Z"),
      receivedAt: new Date("2026-07-03T10:00:10.000Z"),
      exif: { device: "test" },
    })
    expect(result.status).toBe("REVIEW")
    expect(result.issues).toContain("low_resolution")
  })
})
