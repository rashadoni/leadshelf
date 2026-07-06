import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
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
      forcePathStyle: true,
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
      .catch((error: unknown) => {
        const name = (error as { name?: string }).name
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error
      })
  }
  bucketReady = true
}

export async function getObjectBuffer(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const response = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    const bytes = await response.Body?.transformToByteArray()
    if (!bytes) return null
    return {
      body: Buffer.from(bytes),
      contentType: response.ContentType ?? "application/octet-stream",
    }
  } catch (error: unknown) {
    if ((error as { name?: string }).name === "NoSuchKey") return null
    throw error
  }
}

export async function putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket()
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }))
}
