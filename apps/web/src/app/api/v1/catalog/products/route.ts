import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

const querySchema = z.object({
  q: z.string().trim().min(1).optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  missingDimensions: z.coerce.boolean().optional(),
  missingBarcode: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
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
      category: { select: { id: true, name: true, normalizedPath: true } },
      barcodes: { where: { isPrimary: true }, select: { barcode: true } },
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
      brand: p.brand,
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
