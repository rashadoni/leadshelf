import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"
import { productImageKey, putObject } from "@/server/storage/s3"

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
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "too_large" }, { status: 413 })

  const key = productImageKey(session.org, product.id, ext)
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type)

  // ProductImage — дочерняя модель (parent-path): продукт уже проверен выше
  const count = await workerDb.productImage.count({ where: { productId: product.id } })
  const image = await workerDb.productImage.create({
    data: { productId: product.id, url: key, kind: "front", sortOrder: count },
  })

  return NextResponse.json({ id: image.id, url: `/api/media/${key}` }, { status: 201 })
}
