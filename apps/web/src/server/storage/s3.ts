import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

// S3-совместимое хранилище (dev: MinIO из docker-compose; прод: MinIO на
// VPS, позже R2 — API тот же, см. docs/12). Ключи ВСЕГДА начинаются с
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

let bucketReady = false
async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }))
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
