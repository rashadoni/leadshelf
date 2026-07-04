import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"

export const runtime = "nodejs"

// UI ручного ввода/коррекции размеров — обязательная часть MVP (docs/03).
const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const dimensionsSchema = z
  .object({
    sku: z.string().trim().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(512).optional(),
    unit: z.enum(["PCS", "BOX", "KG", "L", "PACK"]).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    brandId: z.string().min(1).nullable().optional(),
    supplierId: z.string().min(1).nullable().optional(),
    manufacturerId: z.string().min(1).nullable().optional(),
    barcode: z.string().trim().min(1).max(128).nullable().optional(),
    isSoftPack: z.boolean().optional(),
    isActive: z.boolean().optional(),
    widthMm: z.number().int().positive().nullable().optional(),
    heightMm: z.number().int().positive().nullable().optional(),
    depthMm: z.number().int().positive().nullable().optional(),
    weightG: z.number().int().positive().nullable().optional(),
  })
  .strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = dimensionsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const existing = await tenantDb(session.org).product.findFirst({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { barcode, ...data } = parsed.data
  await workerDb.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data,
    })
    if (barcode !== undefined) {
      await tx.productBarcode.deleteMany({ where: { organizationId: session.org, productId: id, isPrimary: true } })
      if (barcode) {
        await tx.productBarcode.create({
          data: { organizationId: session.org, productId: id, barcode, isPrimary: true },
        })
      }
    }
  })
  return NextResponse.json({ ok: true })
}
