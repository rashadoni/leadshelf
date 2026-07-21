import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import type { RetentionObjectStore, RetentionObjectVersion } from "./media-purge"

type VersionPage = {
  versions: Array<{ key?: string; versionId?: string }>
  deleteMarkers: Array<{ key?: string; versionId?: string }>
  isTruncated: boolean
  nextKeyMarker?: string
  nextVersionIdMarker?: string
}

export async function collectExactObjectVersions(
  key: string,
  listPage: (markers: { keyMarker?: string; versionIdMarker?: string }) => Promise<VersionPage>,
): Promise<RetentionObjectVersion[]> {
  let keyMarker: string | undefined
  let versionIdMarker: string | undefined
  const seen = new Set<string>()
  const result: RetentionObjectVersion[] = []
  do {
    const page = await listPage({ keyMarker, versionIdMarker })
    for (const version of page.versions) {
      if (version.key === key) result.push({ versionId: version.versionId ?? null, deleteMarker: false })
    }
    for (const marker of page.deleteMarkers) {
      if (marker.key === key) result.push({ versionId: marker.versionId ?? null, deleteMarker: true })
    }
    if (!page.isTruncated) break
    if (!page.nextKeyMarker) throw new Error("object_store_cursor_invalid")
    const cursor = `${page.nextKeyMarker}\0${page.nextVersionIdMarker ?? ""}`
    if (seen.has(cursor)) throw new Error("object_store_cursor_invalid")
    seen.add(cursor)
    keyMarker = page.nextKeyMarker
    versionIdMarker = page.nextVersionIdMarker
  } while (true)
  return result
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error("object_store_not_configured")
  return value
}

export function createRetentionS3ObjectStore(): RetentionObjectStore {
  const bucket = required("RETENTION_S3_BUCKET")
  const client = new S3Client({
    endpoint: required("RETENTION_S3_ENDPOINT"),
    region: process.env.RETENTION_S3_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: required("RETENTION_S3_ACCESS_KEY"),
      secretAccessKey: required("RETENTION_S3_SECRET_KEY"),
    },
    forcePathStyle: true,
  })
  return {
    async listExactVersions(key: string): Promise<RetentionObjectVersion[]> {
      return collectExactObjectVersions(key, async ({ keyMarker, versionIdMarker }) => {
        const page = await client.send(new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }))
        return {
          versions: (page.Versions ?? []).map((version) => ({ key: version.Key, versionId: version.VersionId })),
          deleteMarkers: (page.DeleteMarkers ?? []).map((marker) => ({ key: marker.Key, versionId: marker.VersionId })),
          isTruncated: page.IsTruncated === true,
          nextKeyMarker: page.NextKeyMarker,
          nextVersionIdMarker: page.NextVersionIdMarker,
        }
      })
    },
    async headExists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        const name = (error as { name?: string }).name
        if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false
        throw error
      }
    },
    async deleteExactVersion(key: string, versionId: string | null): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId ?? undefined }))
    },
  }
}
