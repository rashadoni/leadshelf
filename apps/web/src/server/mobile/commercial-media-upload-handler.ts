import { NextResponse, type NextRequest } from "next/server"
import { mobileCommercialMediaUploadFieldsSchema } from "@leadshelf/api-contracts/mobile/v1"
import { protocolMismatchFromHeader } from "@/server/mobile/protocol"
import { putObject } from "@/server/storage/s3"
import type { MobilePhotoSession } from "@/server/mobile/photo-upload-handler"

const MAX_PHOTO_SIZE = 15 * 1024 * 1024
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export async function handleCommercialMediaUpload(req: NextRequest, session: MobilePhotoSession) {
  const mismatch = protocolMismatchFromHeader(req)
  if (mismatch) return mismatch

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 })
  const parsed = mobileCommercialMediaUploadFieldsSchema.safeParse({
    clientMediaId: form!.get("clientMediaId"),
    purpose: form!.get("purpose"),
    takenAt: form!.get("takenAt"),
  })
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const extension = ALLOWED[file.type]
  if (!extension) return NextResponse.json({ error: "unsupported_type" }, { status: 415 })
  if (file.size <= 0) return NextResponse.json({ error: "empty_file" }, { status: 400 })
  if (file.size > MAX_PHOTO_SIZE) return NextResponse.json({ error: "too_large" }, { status: 413 })

  const purposePath = parsed.data.purpose === "PROMOTION_PROOF" ? "promotion" : "return"
  const key = `commercial-media/${session.org}/${session.sub}/${purposePath}/${parsed.data.clientMediaId}.${extension}`
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type)

  return NextResponse.json({
    mediaId: parsed.data.clientMediaId,
    key,
    purpose: parsed.data.purpose,
  }, { status: 201 })
}
