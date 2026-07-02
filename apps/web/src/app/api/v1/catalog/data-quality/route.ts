import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb } from "@/server/db/client"

export const runtime = "nodejs"

// Data quality report — первоклассный экран Phase 1 (docs/03):
// без размеров/штрихкода/фото/категории товар бесполезен для планограммы.

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const db = tenantDb(session.org)

  const activeOnly = { isActive: true }
  const [
    totalProducts,
    missingDimensions,
    missingBarcode,
    missingImage,
    missingCategory,
    recentBatches,
  ] = await Promise.all([
    db.product.count({ where: activeOnly }),
    db.product.count({
      where: { ...activeOnly, OR: [{ widthMm: null }, { heightMm: null }, { depthMm: null }] },
    }),
    db.product.count({ where: { ...activeOnly, barcodes: { none: {} } } }),
    db.product.count({ where: { ...activeOnly, images: { none: {} } } }),
    db.product.count({ where: { ...activeOnly, categoryId: null } }),
    db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        entityType: true,
        status: true,
        totalRows: true,
        errorRows: true,
        createdAt: true,
      },
    }),
  ])

  return NextResponse.json({
    products: {
      total: totalProducts,
      missingDimensions,
      missingBarcode,
      missingImage,
      missingCategory,
      planogramReady: totalProducts - missingDimensions,
    },
    recentBatches: recentBatches.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    })),
  })
}
