import { describe, expect, it } from "vitest"
import { buildVisionMediaUrl, verifyVisionMediaSignature } from "./vision-media-url"

describe("vision media signed URLs", () => {
  const key = "photos/org-a/task-a/photo-a.jpg"
  const now = new Date("2026-07-06T09:00:00.000Z")

  it("keeps the private object key when signed media is not configured", () => {
    expect(buildVisionMediaUrl({ key, publicBaseUrl: "", secret: "", now })).toBe(key)
  })

  it("builds a short-lived signed route for photo keys", () => {
    const url = buildVisionMediaUrl({
      key,
      publicBaseUrl: "https://hermescrm.xyz/",
      secret: "secret-a",
      now,
      ttlSeconds: 60,
    })
    const parsed = new URL(url)

    expect(parsed.origin).toBe("https://hermescrm.xyz")
    expect(parsed.pathname).toBe("/api/vision-media/photos/org-a/task-a/photo-a.jpg")
    expect(parsed.searchParams.get("expires")).toBe("1783328460")
    expect(
      verifyVisionMediaSignature({
        key,
        expires: Number(parsed.searchParams.get("expires")),
        signature: parsed.searchParams.get("sig") ?? "",
        secret: "secret-a",
        now,
      }),
    ).toBe(true)
  })

  it("rejects expired or tampered signatures", () => {
    const url = buildVisionMediaUrl({
      key,
      publicBaseUrl: "https://hermescrm.xyz",
      secret: "secret-a",
      now,
      ttlSeconds: 1,
    })
    const parsed = new URL(url)
    const expires = Number(parsed.searchParams.get("expires"))
    const signature = parsed.searchParams.get("sig") ?? ""

    expect(
      verifyVisionMediaSignature({
        key,
        expires,
        signature,
        secret: "secret-a",
        now: new Date("2026-07-06T09:00:02.000Z"),
      }),
    ).toBe(false)
    expect(
      verifyVisionMediaSignature({
        key: "photos/org-a/task-a/other.jpg",
        expires,
        signature,
        secret: "secret-a",
        now,
      }),
    ).toBe(false)
  })
})
