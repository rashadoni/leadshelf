import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  planAutoPlacementInZone,
  shelfSpaceForShelf,
  type EquipmentGeometryMm,
  type PlacementCandidateMm,
} from "@leadshelf/core"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const schema = z.object({
  expectedRevision: z.string().datetime(),
  categoryId: z.string().min(1).nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
  supplierId: z.string().min(1).nullable().optional(),
  sortBy: z.enum(["turnover", "profit", "quantity", "name", "height"]).default("turnover"),
  facingsBy: z.enum(["turnover", "profit", "quantity"]).default("quantity"),
  excludeSkus: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  maxBrandSharePct: z.number().int().min(1).max(100).nullable().optional(),
  autoCompressSoftPacks: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(30),
})

function decimalNumber(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (typeof value === "object" && "toString" in value) return Number(value.toString())
  return 0
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planogramId: string; versionId: string; zoneId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()
  const { planogramId, versionId, zoneId } = await params

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const data = parsed.data

  const version = await workerDb.planogramVersion.findFirst({
    where: { id: versionId, planogramId, planogram: { organizationId: session.org } },
    include: {
      equipment: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        include: { equipmentVersion: { include: { shelves: true } } },
      },
      zones: { where: { id: zoneId }, take: 1 },
      placements: true,
    },
  })
  if (!version) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (version.state !== "DRAFT") return NextResponse.json({ error: "invalid_state" }, { status: 409 })
  if (version.updatedAt.getTime() !== new Date(data.expectedRevision).getTime()) {
    return NextResponse.json({ error: "version_conflict" }, { status: 409 })
  }
  const equipmentRow = version.equipment[0]
  const zone = version.zones[0]
  if (!equipmentRow || !zone) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const alreadyPlacedProductIds = new Set(version.placements.map((placement) => placement.productId))
  const products = await workerDb.product.findMany({
    where: {
      organizationId: session.org,
      isActive: true,
      categoryId: data.categoryId ?? undefined,
      brandId: data.brandId ?? undefined,
      supplierId: data.supplierId ?? undefined,
      widthMm: { not: null },
      heightMm: { not: null },
      depthMm: { not: null },
      id: alreadyPlacedProductIds.size ? { notIn: [...alreadyPlacedProductIds] } : undefined,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      brandId: true,
      widthMm: true,
      heightMm: true,
      depthMm: true,
      isSoftPack: true,
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
    },
    take: 500,
  })
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sales = await workerDb.salesSnapshot.groupBy({
    by: ["productId"],
    where: { organizationId: session.org, productId: { in: products.map((product) => product.id) }, date: { gte: since } },
    _sum: { quantity: true, revenue: true, profit: true },
  })
  const salesByProduct = new Map(sales.map((row) => [row.productId, row._sum]))
  function metric(productId: string, key: "turnover" | "profit" | "quantity") {
    const row = salesByProduct.get(productId)
    if (key === "turnover") return decimalNumber(row?.revenue)
    if (key === "profit") return decimalNumber(row?.profit)
    return decimalNumber(row?.quantity)
  }

  const excludedSkus = new Set(data.excludeSkus.map((sku) => sku.toLowerCase()))
  const sorted = products
    .filter((product) => !excludedSkus.has(product.sku.toLowerCase()))
    .map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      brandId: product.brandId,
      imageKey: product.images[0]?.url ?? null,
      widthMm: product.widthMm!,
      heightMm: product.heightMm!,
      depthMm: product.depthMm!,
      isSoftPack: product.isSoftPack,
      score: metric(product.id, data.facingsBy),
      sortScore:
        data.sortBy === "name"
          ? 0
          : data.sortBy === "height"
            ? product.heightMm!
            : metric(product.id, data.sortBy),
    }))
    .sort((a, b) => {
      if (data.sortBy === "name") return a.name.localeCompare(b.name)
      return b.sortScore - a.sortScore || a.name.localeCompare(b.name)
    })
    .filter((product, _index, array) => {
      if (!data.maxBrandSharePct || !product.brandId) return true
      const maxPerBrand = Math.max(1, Math.floor((data.limit * data.maxBrandSharePct) / 100))
      return array.filter((candidate) => candidate.brandId === product.brandId).indexOf(product) < maxPerBrand
    })

  const equipment: EquipmentGeometryMm = {
    widthMm: equipmentRow.equipmentVersion.widthMm,
    heightMm: equipmentRow.equipmentVersion.heightMm,
    depthMm: equipmentRow.equipmentVersion.depthMm,
    shelves: equipmentRow.equipmentVersion.shelves.map((shelf) => ({
      id: shelf.id,
      shelfIndex: shelf.shelfIndex,
      yMm: shelf.yMm,
      thicknessMm: shelf.thicknessMm,
      depthMm: shelf.depthMm,
    })),
  }
  const existing: PlacementCandidateMm[] = version.placements.map((placement) => ({
    id: placement.id,
    shelfId: placement.shelfId ?? "",
    xMm: placement.xMm,
    widthMm: placement.widthMm,
    heightMm: placement.heightMm,
    depthMm: placement.depthMm,
    compressionX: placement.compressionX,
    compressionY: placement.compressionY,
    compressionZ: placement.compressionZ,
    facingsX: placement.facingsX,
    facingsY: placement.facingsY,
    facingsZ: placement.facingsZ,
    rotationX: placement.rotationX,
    rotationY: placement.rotationY,
    rotationZ: placement.rotationZ,
    stackMode: placement.stackMode,
  }))
  const plan = planAutoPlacementInZone({
    equipment,
    zone: { id: zone.id, xMm: zone.xMm, yMm: zone.yMm, widthMm: zone.widthMm, heightMm: zone.heightMm },
    existing,
    products: sorted.map((product) => ({
      ...product,
      isSoftPack: data.autoCompressSoftPacks && product.isSoftPack,
    })),
    maxProducts: data.limit,
  })
  const productById = new Map(sorted.map((product) => [product.id, product]))

  const result = await workerDb.$transaction(async (tx) => {
    const created = []
    for (const item of plan.placements) {
      const product = productById.get(item.productId)
      const shelf = shelfSpaceForShelf(equipment, item.shelfId)
      if (!product || !shelf) continue
      const placement = await tx.planogramPlacement.create({
        data: {
          planogramVersionId: version.id,
          planogramEquipmentId: equipmentRow.id,
          shelfId: item.shelfId,
          zoneId: zone.id,
          productId: product.id,
          xMm: item.xMm,
          yMm: shelf.surfaceYMm,
          zMm: 0,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          depthMm: product.depthMm,
          compressionX: item.compressionX,
          facingsX: item.facingsX,
          facingsY: item.facingsY,
          facingsZ: item.facingsZ,
          metadata: {
            autofill: {
              zoneId: zone.id,
              sortBy: data.sortBy,
              facingsBy: data.facingsBy,
              excludeSkus: data.excludeSkus,
              maxBrandSharePct: data.maxBrandSharePct ?? null,
              autoCompressSoftPacks: data.autoCompressSoftPacks,
              compressionX: item.compressionX,
              score: item.score,
              reason: item.reason,
            },
          },
        },
      })
      created.push({
        id: placement.id,
        shelfId: placement.shelfId ?? "",
        xMm: placement.xMm,
        widthMm: placement.widthMm,
        heightMm: placement.heightMm,
        depthMm: placement.depthMm,
        compressionX: placement.compressionX,
        facingsX: placement.facingsX,
        facingsY: placement.facingsY,
        facingsZ: placement.facingsZ,
        rotationX: placement.rotationX,
        rotationY: placement.rotationY,
        rotationZ: placement.rotationZ,
        stackMode: placement.stackMode,
        product: {
          id: product.id,
          sku: product.sku,
          barcode: null,
          name: product.name,
          brandName: null,
          imageKey: product.imageKey,
        },
      })
    }
    const updated = await tx.planogramVersion.update({
      where: { id: version.id },
      data: { updatedAt: new Date() },
      select: { updatedAt: true },
    })
    return { placements: created, revision: updated.updatedAt.toISOString() }
  })

  return NextResponse.json({
    ...result,
    log: {
      selected: sorted.slice(0, data.limit).map((product) => ({
        productId: product.id,
        sku: product.sku,
        score: product.score,
        sortScore: product.sortScore,
        isSoftPack: product.isSoftPack,
      })),
      placed: plan.placements.map((placement) => ({
        productId: placement.productId,
        shelfId: placement.shelfId,
        xMm: placement.xMm,
        facingsX: placement.facingsX,
        compressionX: placement.compressionX,
        reason: placement.reason,
      })),
      rejected: plan.rejected,
    },
  })
}
