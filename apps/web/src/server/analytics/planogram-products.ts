import type { tenantDb } from "@/server/db/client"

export type ProductRow = {
  key: string
  planogramId: string
  versionId: string
  planogramName: string
  versionNumber: number
  state: string
  sku: string
  productName: string
  category: string | null
  brand: string | null
  supplier: string | null
  placements: number
  units: number
  linearMm: number
}

export type AbcMetric = "turnover" | "cost" | "profit" | "quantity"
export type AbcClass = "A" | "B" | "C"

export type AbcRow = {
  productId: string
  sku: string
  productName: string
  brand: string | null
  category: string | null
  turnover: number
  cost: number
  profit: number
  quantity: number
  classes: Record<AbcMetric, AbcClass>
}

export function formatMeters(mm: number): string {
  return (mm / 1000).toFixed(2)
}

function emptyClasses(): Record<AbcMetric, AbcClass> {
  return { turnover: "C", cost: "C", profit: "C", quantity: "C" }
}

function assignAbcClasses(rows: AbcRow[], metric: AbcMetric): void {
  const ranked = [...rows].sort((a, b) => b[metric] - a[metric])
  const total = ranked.reduce((sum, row) => sum + Math.max(0, row[metric]), 0)
  if (total <= 0) return

  let cumulative = 0
  for (const row of ranked) {
    cumulative += Math.max(0, row[metric])
    const share = cumulative / total
    row.classes[metric] = share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C"
  }
}

type TenantDb = ReturnType<typeof tenantDb>

export async function getPlanogramProductRows(db: TenantDb): Promise<ProductRow[]> {
  const placements = await db.planogramPlacement.findMany({
    where: { planogramVersion: { state: { in: ["DRAFT", "PUBLISHED"] } } },
    include: {
      planogramVersion: {
        select: {
          id: true,
          versionNumber: true,
          state: true,
          planogram: { select: { id: true, name: true } },
        },
      },
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ planogramVersionId: "asc" }, { productId: "asc" }, { sortOrder: "asc" }],
    take: 2000,
  })

  const rowsByKey = new Map<string, ProductRow>()
  for (const placement of placements) {
    const key = `${placement.planogramVersionId}:${placement.productId}`
    const units = placement.facingsX * placement.facingsY * placement.facingsZ
    const linearMm = placement.widthMm * placement.facingsX
    const existing = rowsByKey.get(key)
    if (existing) {
      existing.placements += 1
      existing.units += units
      existing.linearMm += linearMm
      continue
    }
    rowsByKey.set(key, {
      key,
      planogramId: placement.planogramVersion.planogram.id,
      versionId: placement.planogramVersion.id,
      planogramName: placement.planogramVersion.planogram.name,
      versionNumber: placement.planogramVersion.versionNumber,
      state: placement.planogramVersion.state,
      sku: placement.product.sku,
      productName: placement.product.name,
      category: placement.product.category?.name ?? null,
      brand: placement.product.brand?.name ?? null,
      supplier: placement.product.supplier?.name ?? null,
      placements: 1,
      units,
      linearMm,
    })
  }

  return [...rowsByKey.values()].sort((a, b) => {
    const planogram = a.planogramName.localeCompare(b.planogramName)
    if (planogram !== 0) return planogram
    return a.sku.localeCompare(b.sku)
  })
}

export async function getAbcRows(db: TenantDb): Promise<AbcRow[]> {
  const sales = await db.salesSnapshot.findMany({
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          brand: { select: { name: true } },
          category: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "desc" }, { productId: "asc" }],
    take: 5000,
  })

  const rowsByProduct = new Map<string, AbcRow>()
  for (const sale of sales) {
    const revenue = Number(sale.revenue)
    const profit = sale.profit == null ? 0 : Number(sale.profit)
    const cost = sale.profit == null ? 0 : revenue - profit
    const quantity = Number(sale.quantity)
    const existing = rowsByProduct.get(sale.productId)
    if (existing) {
      existing.turnover += revenue
      existing.profit += profit
      existing.cost += cost
      existing.quantity += quantity
      continue
    }
    rowsByProduct.set(sale.productId, {
      productId: sale.productId,
      sku: sale.product.sku,
      productName: sale.product.name,
      brand: sale.product.brand?.name ?? null,
      category: sale.product.category?.name ?? null,
      turnover: revenue,
      cost,
      profit,
      quantity,
      classes: emptyClasses(),
    })
  }

  const rows = [...rowsByProduct.values()].sort((a, b) => b.turnover - a.turnover)
  assignAbcClasses(rows, "turnover")
  assignAbcClasses(rows, "cost")
  assignAbcClasses(rows, "profit")
  assignAbcClasses(rows, "quantity")
  return rows
}
