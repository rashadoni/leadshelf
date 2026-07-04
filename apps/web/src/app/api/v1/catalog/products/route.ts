import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"

export const runtime = "nodejs"
const EDIT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER", "MERCHANDISER"])

const querySchema = z.object({
  q: z.string().trim().min(1).optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  missingDimensions: z.coerce.boolean().optional(),
  missingBarcode: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

const productCreateSchema = z.object({
  sku: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(512),
  unit: z.enum(["PCS", "BOX", "KG", "L", "PACK"]).default("PCS"),
  categoryId: z.string().min(1).nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
  supplierId: z.string().min(1).nullable().optional(),
  manufacturerId: z.string().min(1).nullable().optional(),
  barcode: z.string().trim().min(1).max(128).nullable().optional(),
  widthMm: z.number().int().positive().nullable().optional(),
  heightMm: z.number().int().positive().nullable().optional(),
  depthMm: z.number().int().positive().nullable().optional(),
  weightG: z.number().int().positive().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", details: parsed.error.flatten() }, { status: 400 })
  }
  const { q, categoryId, brandId, missingDimensions, missingBarcode, limit, cursor } = parsed.data

  const products = await tenantDb(session.org).product.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { barcodes: { some: { barcode: { startsWith: q } } } },
            ],
          }
        : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
      // статус «размеры отсутствуют» деривативен от NULL-габаритов (docs/03)
      ...(missingDimensions
        ? { OR: [{ widthMm: null }, { heightMm: null }, { depthMm: null }] }
        : {}),
      ...(missingBarcode ? { barcodes: { none: {} } } : {}),
    },
    include: {
      brand: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      manufacturer: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, normalizedPath: true } },
      barcodes: { where: { isPrimary: true }, select: { barcode: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = products.length > limit
  const page = hasMore ? products.slice(0, limit) : products

  return NextResponse.json({
    products: page.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      barcode: p.barcodes[0]?.barcode ?? null,
      imageKey: p.images[0]?.url ?? null,
      brand: p.brand,
      supplier: p.supplier,
      manufacturer: p.manufacturer,
      category: p.category,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      depthMm: p.depthMm,
      weightG: p.weightG,
      hasDimensions: p.widthMm != null && p.heightMm != null && p.depthMm != null,
      isActive: p.isActive,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!EDIT_ROLES.has(session.role)) return forbidden()

  const parsed = productCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { barcode, ...data } = parsed.data
  const refs = await Promise.all([
    data.categoryId
      ? workerDb.category.findFirst({ where: { id: data.categoryId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
    data.brandId
      ? workerDb.brand.findFirst({ where: { id: data.brandId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
    data.supplierId
      ? workerDb.supplier.findFirst({ where: { id: data.supplierId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
    data.manufacturerId
      ? workerDb.manufacturer.findFirst({ where: { id: data.manufacturerId, organizationId: session.org }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (data.categoryId && !refs[0]) return NextResponse.json({ error: "category_not_found" }, { status: 404 })
  if (data.brandId && !refs[1]) return NextResponse.json({ error: "brand_not_found" }, { status: 404 })
  if (data.supplierId && !refs[2]) return NextResponse.json({ error: "supplier_not_found" }, { status: 404 })
  if (data.manufacturerId && !refs[3]) return NextResponse.json({ error: "manufacturer_not_found" }, { status: 404 })

  try {
    const product = await workerDb.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId: session.org,
          sku: data.sku,
          name: data.name,
          unit: data.unit,
          categoryId: data.categoryId ?? null,
          brandId: data.brandId ?? null,
          supplierId: data.supplierId ?? null,
          manufacturerId: data.manufacturerId ?? null,
          widthMm: data.widthMm ?? null,
          heightMm: data.heightMm ?? null,
          depthMm: data.depthMm ?? null,
          weightG: data.weightG ?? null,
        },
        select: { id: true, sku: true, name: true },
      })
      if (barcode) {
        await tx.productBarcode.create({
          data: { organizationId: session.org, productId: created.id, barcode, isPrimary: true },
        })
      }
      return created
    })
    return NextResponse.json({ product }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "duplicate_product_or_barcode" }, { status: 409 })
    }
    throw error
  }
}
