import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

// S3-совместимое хранилище (dev: MinIO из docker-compose; production:
// поддерживаемый внешний S3/R2 provider). Ключи ВСЕГДА начинаются с
// products/{organizationId}/ — media-proxy сверяет префикс с сессией.

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} не задан (apps/web/.env)`)
  return v
}

let client: S3Client | null = null
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: required("S3_ENDPOINT"),
      region: process.env.S3_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: required("S3_ACCESS_KEY"),
        secretAccessKey: required("S3_SECRET_KEY"),
      },
      forcePathStyle: true, // MinIO
    })
  }
  return client
}

function bucket(): string {
  return process.env.S3_BUCKET ?? "leadshelf-media"
}

export interface ObjectStorageInventory {
  objects: number
  bytes: number
  collectedAtMs: number
}

interface ObjectStorageInventoryPage {
  objects: Array<{ size?: number }>
  isTruncated: boolean
  nextToken?: string
}

export async function collectObjectStorageInventory(
  listPage: (continuationToken?: string) => Promise<ObjectStorageInventoryPage>,
): Promise<{ objects: number; bytes: number }> {
  let continuationToken: string | undefined
  let objects = 0
  let bytes = 0
  const seenTokens = new Set<string>()

  do {
    const page = await listPage(continuationToken)
    for (const object of page.objects) {
      objects += 1
      bytes += Number.isFinite(object.size) && (object.size ?? 0) > 0
        ? Math.floor(object.size!)
        : 0
    }
    if (!page.isTruncated) break
    const next = page.nextToken
    if (!next || seenTokens.has(next)) throw new Error("object_storage_inventory_cursor_invalid")
    seenTokens.add(next)
    continuationToken = next
  } while (true)

  return { objects, bytes }
}

let inventoryCache: ObjectStorageInventory | null = null
let inventoryInFlight: Promise<ObjectStorageInventory> | null = null

function inventoryCacheMs(): number {
  const parsed = Number(process.env.S3_INVENTORY_CACHE_MS)
  return Number.isInteger(parsed) && parsed >= 60_000 && parsed <= 24 * 60 * 60_000
    ? parsed
    : 15 * 60_000
}

export async function getObjectStorageInventory(nowMs = Date.now()): Promise<ObjectStorageInventory> {
  if (inventoryCache && nowMs - inventoryCache.collectedAtMs < inventoryCacheMs()) {
    return inventoryCache
  }
  if (inventoryInFlight) return inventoryInFlight

  inventoryInFlight = collectObjectStorageInventory(async (continuationToken) => {
    const page = await s3().send(new ListObjectsV2Command({
      Bucket: bucket(),
      ContinuationToken: continuationToken,
    }))
    return {
      objects: (page.Contents ?? []).map((object) => ({ size: object.Size })),
      isTruncated: page.IsTruncated === true,
      nextToken: page.NextContinuationToken,
    }
  }).then((inventory) => {
    inventoryCache = { ...inventory, collectedAtMs: nowMs }
    return inventoryCache
  }).finally(() => {
    inventoryInFlight = null
  })
  return inventoryInFlight
}

export async function checkObjectStorage(): Promise<void> {
  await s3().send(new HeadBucketCommand({ Bucket: bucket() }))
}

let bucketReady = false
async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  try {
    await checkObjectStorage()
  } catch {
    await s3()
      .send(new CreateBucketCommand({ Bucket: bucket() }))
      .catch((e: unknown) => {
        const name = (e as { name?: string }).name
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw e
      })
  }
  bucketReady = true
}

export function productImageKey(organizationId: string, productId: string, ext: string): string {
  return `products/${organizationId}/${productId}/${crypto.randomUUID()}.${ext}`
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket()
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  )
}

export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    return {
      body: res.Body!.transformToWebStream() as ReadableStream,
      contentType: res.ContentType ?? "application/octet-stream",
    }
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "NoSuchKey") return null
    throw e
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
}
