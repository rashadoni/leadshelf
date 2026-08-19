// Заливка демо-плейсхолдеров в объектное хранилище.
//
// productImage.url всегда указывал на ключ, который никто не записывал:
// картинку подменял media-proxy, но только на профиле demo. На client-профиле
// (прод-compose) тот же ключ отдавал 404 — каталог показывал битые превью, а
// 2D-планограмма рисовала товар пустым прямоугольником поверх полки.
//
// Трогаем ТОЛЬКО ключи, оканчивающиеся на DEMO_PRODUCT_IMAGE_FILENAME: это
// плейсхолдеры, созданные сидом. Настоящее фото клиента подменять заглушкой
// нельзя — отсутствующий объект там означает потерю данных, а не пропуск.

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import {
  DEMO_PRODUCT_IMAGE_FILENAME,
  DEMO_PRODUCT_PACK_SVG,
} from "./demo-media.ts"

export interface DemoMediaBackfillResult {
  checked: number
  missing: number
  uploaded: number
}

export interface DemoMediaBackfillInput {
  // Prisma-клиент передаётся снаружи: пакет db не создаёт соединение сам.
  prisma: {
    productImage: {
      findMany(args: unknown): Promise<Array<{ url: string }>>
    }
  }
  organizationId?: string
  // false — только отчёт, ничего не пишем.
  apply: boolean
}

export function demoMediaClient(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY
  const secretAccessKey = process.env.S3_SECRET_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) return null
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // MinIO
  })
}

export function demoMediaBucket(): string {
  return process.env.S3_BUCKET ?? "leadshelf-media"
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

export async function backfillDemoProductImages(
  input: DemoMediaBackfillInput,
): Promise<DemoMediaBackfillResult> {
  const client = demoMediaClient()
  if (!client) throw new Error("S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY не заданы")
  const bucket = demoMediaBucket()

  const rows = await input.prisma.productImage.findMany({
    where: {
      url: { endsWith: `/${DEMO_PRODUCT_IMAGE_FILENAME}` },
      ...(input.organizationId
        ? { product: { organizationId: input.organizationId } }
        : {}),
    },
    select: { url: true },
  })

  const keys = [...new Set(rows.map((row) => row.url))]
  let missing = 0
  let uploaded = 0
  for (const key of keys) {
    if (await objectExists(client, bucket, key)) continue
    missing += 1
    if (!input.apply) continue
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: DEMO_PRODUCT_PACK_SVG,
      ContentType: "image/svg+xml; charset=utf-8",
    }))
    uploaded += 1
  }

  return { checked: keys.length, missing, uploaded }
}
