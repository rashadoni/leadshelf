import { describe, expect, it } from "vitest"
import { matchesDeclaredMediaType } from "./media-signature"

const ascii = (value: string) => new TextEncoder().encode(value)

describe("media signature guard", () => {
  it("accepts supported signatures", () => {
    expect(matchesDeclaredMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true)
    expect(matchesDeclaredMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), "image/png")).toBe(true)
    expect(matchesDeclaredMediaType(ascii("RIFF0000WEBP"), "image/webp")).toBe(true)
    expect(matchesDeclaredMediaType(ascii("0000ftypisom"), "video/mp4")).toBe(true)
    expect(matchesDeclaredMediaType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "video/webm")).toBe(true)
  })

  it("rejects content-type spoofing and unsupported types", () => {
    const executable = ascii("MZnot-an-image")
    expect(matchesDeclaredMediaType(executable, "image/jpeg")).toBe(false)
    expect(matchesDeclaredMediaType(executable, "video/mp4")).toBe(false)
    expect(matchesDeclaredMediaType(executable, "application/octet-stream")).toBe(false)
  })

  it("does not confuse different supported image formats", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
    expect(matchesDeclaredMediaType(png, "image/jpeg")).toBe(false)
  })
})
