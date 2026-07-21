import { describe, expect, it, vi } from "vitest"

import { collectExactObjectVersions, createRetentionS3ObjectStore } from "./s3-version-store"

describe("retention S3 version inventory", () => {
  it("paginates versions and delete markers while excluding prefix neighbors", async () => {
    const key = "photos/org-a/task/photo.jpg"
    const list = vi.fn()
      .mockResolvedValueOnce({
        versions: [{ key, versionId: "v2" }, { key: `${key}.neighbor`, versionId: "foreign" }],
        deleteMarkers: [],
        isTruncated: true,
        nextKeyMarker: key,
        nextVersionIdMarker: "v2",
      })
      .mockResolvedValueOnce({
        versions: [{ key, versionId: "v1" }],
        deleteMarkers: [{ key, versionId: "delete-1" }],
        isTruncated: false,
      })
    await expect(collectExactObjectVersions(key, list)).resolves.toEqual([
      { versionId: "v2", deleteMarker: false },
      { versionId: "v1", deleteMarker: false },
      { versionId: "delete-1", deleteMarker: true },
    ])
    expect(list).toHaveBeenNthCalledWith(2, { keyMarker: key, versionIdMarker: "v2" })
  })

  it("fails closed for a repeated or incomplete pagination cursor", async () => {
    const key = "photos/org-a/task/photo.jpg"
    await expect(collectExactObjectVersions(key, async () => ({
      versions: [], deleteMarkers: [], isTruncated: true,
    }))).rejects.toThrow("object_store_cursor_invalid")
    const repeated = async () => ({
      versions: [], deleteMarkers: [], isTruncated: true,
      nextKeyMarker: key, nextVersionIdMarker: "v1",
    })
    await expect(collectExactObjectVersions(key, repeated)).rejects.toThrow("object_store_cursor_invalid")
  })

  it("does not fall back to the normal application writer credentials", () => {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("RETENTION_S3_") || key.startsWith("S3_")))
    for (const key of Object.keys(process.env)) if (key.startsWith("RETENTION_S3_")) delete process.env[key]
    process.env.S3_ENDPOINT = "https://application-storage.invalid"
    process.env.S3_ACCESS_KEY = "application-writer"
    process.env.S3_SECRET_KEY = "application-secret"
    process.env.S3_BUCKET = "application-bucket"
    try {
      expect(() => createRetentionS3ObjectStore()).toThrow("object_store_not_configured")
    } finally {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("RETENTION_S3_") || key.startsWith("S3_")) delete process.env[key]
      }
      Object.assign(process.env, saved)
    }
  })
})
