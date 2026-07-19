import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"
import { deleteObject, productImageKey, putObject } from "@/server/storage/s3"
import { attemptObjectWrite, persistWithObjectCleanup } from "@/server/storage/object-compensation"
import { acquireMediaUploadAdmission } from "@/server/mobile/media-upload-admission"
import { matchesDeclaredMediaType } from "@/server/security/media-signature"

export const runtime = "nodejs"

const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params

  const admission = await acquireMediaUploadAdmission(
    "catalog-image-upload",
    `${session.org}:${session.sub}`,
    { max: 60, windowMs: 60 * 60_000 },
  )
  if (!admission.ok) return admission.response
  return handleProductImageUpload(req, session, id).finally(admission.release)
}

async function handleProductImageUpload(
  req: NextRequest,
  session: NonNullable<Awaited<ReturnType<typeof requireApiSession>>>,
  id: string,
) {
  const product = await tenantDb(session.org).product.findFirst({
    where: { id },
    select: { id: true },
  })
  if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 })
  }
  const ext = ALLOWED[file.type]
  if (!ext) return NextResponse.json({ error: "unsupported_type" }, { status: 415 })
  if (file.size <= 0) return NextResponse.json({ error: "empty_file" }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "too_large" }, { status: 413 })

  const key = productImageKey(session.org, product.id, ext)
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!matchesDeclaredMediaType(bytes, file.type)) {
    return NextResponse.json({ error: "content_signature_mismatch" }, { status: 415 })
  }
  const stored = await attemptObjectWrite(() => putObject(key, bytes, file.type))
  if (!stored) {
    return NextResponse.json(
      { error: "storage_unavailable" },
      { status: 503, headers: { "Retry-After": "5" } },
    )
  }

  const image = await persistWithObjectCleanup({
    persist: async () => {
      // ProductImage — дочерняя модель (parent-path): продукт уже проверен выше
      const count = await workerDb.productImage.count({ where: { productId: product.id } })
      return workerDb.productImage.create({
        data: { productId: product.id, url: key, kind: "front", sortOrder: count },
      })
    },
    cleanup: () => deleteObject(key),
  })

  return NextResponse.json({ id: image.id, url: `/api/media/${key}` }, { status: 201 })
}
