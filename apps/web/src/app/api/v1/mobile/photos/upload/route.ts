import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { putObject } from "@/server/storage/s3"

export const runtime = "nodejs"
export const maxDuration = 120

// Пилот: multipart через приложение (MinIO не публичен, docs/18 решение d).
// Идемпотентность: [organizationId, clientPhotoId] — ретрай не плодит дублей.

const MAX_SIZE = 15 * 1024 * 1024
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

const fieldsSchema = z.object({
  clientPhotoId: z.string().min(8).max(128),
  taskId: z.string().min(1),
  takenAt: z.string().datetime(),
  exifJson: z.string().max(20000).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 })
  const parsed = fieldsSchema.safeParse({
    clientPhotoId: form!.get("clientPhotoId"),
    taskId: form!.get("taskId"),
    takenAt: form!.get("takenAt"),
    exifJson: form!.get("exifJson") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const ext = ALLOWED[file.type]
  if (!ext) return NextResponse.json({ error: "unsupported_type" }, { status: 415 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "too_large" }, { status: 413 })

  // дедуп до записи файла
  const existing = await workerDb.photoSubmission.findFirst({
    where: { organizationId: session.org, clientPhotoId: parsed.data.clientPhotoId },
    select: { id: true, url: true },
  })
  if (existing) {
    return NextResponse.json({ photoId: existing.id, key: existing.url, deduplicated: true })
  }

  const task = await workerDb.task.findFirst({
    where: { id: parsed.data.taskId, organizationId: session.org, assigneeId: session.sub },
    select: { id: true, storeId: true },
  })
  if (!task) return NextResponse.json({ error: "task_not_found_or_not_assigned" }, { status: 404 })

  const key = `photos/${session.org}/${task.id}/${parsed.data.clientPhotoId}.${ext}`
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type)

  let exif: object | undefined
  try {
    exif = parsed.data.exifJson ? JSON.parse(parsed.data.exifJson) : undefined
  } catch {
    exif = undefined
  }

  const photo = await workerDb.photoSubmission.create({
    data: {
      organizationId: session.org,
      storeId: task.storeId,
      taskId: task.id,
      userId: session.sub,
      url: key,
      clientPhotoId: parsed.data.clientPhotoId,
      takenAt: new Date(parsed.data.takenAt),
      exif,
    },
  })
  return NextResponse.json({ photoId: photo.id, key }, { status: 201 })
}
