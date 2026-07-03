import type { tenantDb } from "@/server/db/client"

export type ProductRow = {
  key: string
  productId: string
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

export type StockCoverage = {
  productId: string
  latestStockQty: number
  avgDailySalesQty: number
  stockDays: number | null
}

export type AssortmentGapRow = {
  key: string
  source: "format" | "store"
  scopeName: string
  productId: string
  sku: string
  productName: string
  brand: string | null
  category: string | null
  supplier: string | null
}

export type ObsoleteAssortmentReason = "inactive" | "expired" | "missing" | "productInactive"

export type ObsoletePlanogramRow = {
  key: string
  source: "format" | "store"
  scopeName: string
  planogramId: string
  versionId: string
  planogramName: string
  versionNumber: number
  productId: string
  sku: string
  productName: string
  brand: string | null
  category: string | null
  placements: number
  reason: ObsoleteAssortmentReason
}

export type TaskKpiSummary = {
  total: number
  open: number
  completed: number
  expired: number
  photoSubmitted: number
  overdueOpen: number
  unassignedOpen: number
  photoSubmissions: number
  completionRate: number
  onTimeRate: number | null
  avgCompletionHours: number | null
}

export type TaskKpiGroupRow = {
  key: string
  label: string
  total: number
  open: number
  completed: number
  expired: number
  photoSubmissions: number
  completionRate: number
}

export type TaskKpiReport = {
  summary: TaskKpiSummary
  stores: TaskKpiGroupRow[]
  planograms: TaskKpiGroupRow[]
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
const OPEN_TASK_STATUSES = new Set(["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"])

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
      productId: placement.productId,
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

export async function getStockCoverageByProduct(
  db: TenantDb,
  productIds: string[],
): Promise<Map<string, StockCoverage>> {
  if (productIds.length === 0) return new Map()
  const uniqueProductIds = [...new Set(productIds)]
  const [stockSnapshots, salesSnapshots] = await Promise.all([
    db.stockSnapshot.findMany({
      where: { productId: { in: uniqueProductIds } },
      select: { productId: true, date: true, quantity: true },
      orderBy: [{ date: "desc" }, { productId: "asc" }],
      take: 5000,
    }),
    db.salesSnapshot.findMany({
      where: { productId: { in: uniqueProductIds } },
      select: { productId: true, date: true, quantity: true },
      orderBy: [{ date: "desc" }, { productId: "asc" }],
      take: 5000,
    }),
  ])

  const latestStockByProduct = new Map<string, number>()
  for (const snapshot of stockSnapshots) {
    if (!latestStockByProduct.has(snapshot.productId)) {
      latestStockByProduct.set(snapshot.productId, Number(snapshot.quantity))
    }
  }

  const salesByProduct = new Map<string, { quantity: number; dates: Set<string> }>()
  for (const snapshot of salesSnapshots) {
    const existing = salesByProduct.get(snapshot.productId)
    const dateKey = snapshot.date.toISOString().slice(0, 10)
    if (existing) {
      existing.quantity += Number(snapshot.quantity)
      existing.dates.add(dateKey)
    } else {
      salesByProduct.set(snapshot.productId, {
        quantity: Number(snapshot.quantity),
        dates: new Set([dateKey]),
      })
    }
  }

  const result = new Map<string, StockCoverage>()
  for (const productId of uniqueProductIds) {
    const latestStockQty = latestStockByProduct.get(productId) ?? 0
    const sales = salesByProduct.get(productId)
    const avgDailySalesQty = sales && sales.dates.size > 0 ? sales.quantity / sales.dates.size : 0
    result.set(productId, {
      productId,
      latestStockQty,
      avgDailySalesQty,
      stockDays: avgDailySalesQty > 0 ? latestStockQty / avgDailySalesQty : null,
    })
  }

  return result
}

function isInDateRange(
  range: { validFrom?: Date | null; validTo?: Date | null },
  now: Date,
): boolean {
  if (range.validFrom && range.validFrom > now) return false
  if (range.validTo && range.validTo < now) return false
  return true
}

function isAssignmentActive(
  assignment: { activeFrom: Date; activeTo: Date | null },
  now: Date,
): boolean {
  if (assignment.activeFrom > now) return false
  if (assignment.activeTo && assignment.activeTo < now) return false
  return true
}

function obsoleteReasonForAssortment(
  product: { isActive: boolean },
  assortment: { isActive: boolean; validFrom?: Date | null; validTo?: Date | null } | undefined,
  now: Date,
): ObsoleteAssortmentReason | null {
  if (!product.isActive) return "productInactive"
  if (!assortment) return "missing"
  if (!assortment.isActive) return "inactive"
  if (!isInDateRange(assortment, now)) return "expired"
  return null
}

export async function getAssortmentGapRows(db: TenantDb, now = new Date()): Promise<AssortmentGapRow[]> {
  const [formatAssortment, storeAssortment, assignments] = await Promise.all([
    db.assortmentMatrix.findMany({
      where: { isActive: true },
      include: {
        format: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
            supplier: { select: { name: true } },
          },
        },
      },
      orderBy: [{ formatId: "asc" }, { productId: "asc" }],
      take: 3000,
    }),
    db.storeAssortment.findMany({
      where: { isActive: true },
      include: {
        store: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
            supplier: { select: { name: true } },
          },
        },
      },
      orderBy: [{ storeId: "asc" }, { productId: "asc" }],
      take: 3000,
    }),
    db.planogramAssignment.findMany({
      include: {
        planogramVersion: {
          select: {
            id: true,
            placements: { select: { productId: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 3000,
    }),
  ])

  const placedProductsByFormat = new Map<string, Set<string>>()
  const placedProductsByStore = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    if (!isAssignmentActive(assignment, now)) continue
    const target =
      assignment.formatId != null
        ? placedProductsByFormat
        : assignment.storeId != null
          ? placedProductsByStore
          : null
    const targetId = assignment.formatId ?? assignment.storeId
    if (!target || !targetId) continue
    const productIds = target.get(targetId) ?? new Set<string>()
    for (const placement of assignment.planogramVersion.placements) {
      productIds.add(placement.productId)
    }
    target.set(targetId, productIds)
  }

  const gaps: AssortmentGapRow[] = []
  for (const item of formatAssortment) {
    if (!isInDateRange(item, now)) continue
    if (placedProductsByFormat.get(item.formatId)?.has(item.productId)) continue
    gaps.push({
      key: `format:${item.formatId}:${item.productId}`,
      source: "format",
      scopeName: item.format.name,
      productId: item.productId,
      sku: item.product.sku,
      productName: item.product.name,
      brand: item.product.brand?.name ?? null,
      category: item.product.category?.name ?? null,
      supplier: item.product.supplier?.name ?? null,
    })
  }

  for (const item of storeAssortment) {
    if (!isInDateRange(item, now)) continue
    if (placedProductsByStore.get(item.storeId)?.has(item.productId)) continue
    gaps.push({
      key: `store:${item.storeId}:${item.productId}`,
      source: "store",
      scopeName: item.store.name,
      productId: item.productId,
      sku: item.product.sku,
      productName: item.product.name,
      brand: item.product.brand?.name ?? null,
      category: item.product.category?.name ?? null,
      supplier: item.product.supplier?.name ?? null,
    })
  }

  return gaps.sort((a, b) => {
    const scope = a.scopeName.localeCompare(b.scopeName)
    if (scope !== 0) return scope
    return a.sku.localeCompare(b.sku)
  })
}

export async function getObsoletePlanogramRows(
  db: TenantDb,
  now = new Date(),
): Promise<ObsoletePlanogramRow[]> {
  const [formatAssortment, storeAssortment, assignments] = await Promise.all([
    db.assortmentMatrix.findMany({
      select: {
        formatId: true,
        productId: true,
        isActive: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: [{ formatId: "asc" }, { productId: "asc" }],
      take: 5000,
    }),
    db.storeAssortment.findMany({
      select: {
        storeId: true,
        productId: true,
        isActive: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: [{ storeId: "asc" }, { productId: "asc" }],
      take: 5000,
    }),
    db.planogramAssignment.findMany({
      include: {
        format: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, formatId: true } },
        planogramVersion: {
          select: {
            id: true,
            versionNumber: true,
            planogram: { select: { id: true, name: true } },
            placements: {
              select: {
                productId: true,
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    isActive: true,
                    brand: { select: { name: true } },
                    category: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 3000,
    }),
  ])

  const formatAssortmentByProduct = new Map<
    string,
    { isActive: boolean; validFrom: Date | null; validTo: Date | null }
  >()
  const storeAssortmentByProduct = new Map<
    string,
    { isActive: boolean; validFrom: Date | null; validTo: Date | null }
  >()
  for (const item of formatAssortment) {
    formatAssortmentByProduct.set(`${item.formatId}:${item.productId}`, item)
  }
  for (const item of storeAssortment) {
    storeAssortmentByProduct.set(`${item.storeId}:${item.productId}`, item)
  }

  const rowsByKey = new Map<string, ObsoletePlanogramRow>()
  for (const assignment of assignments) {
    if (!isAssignmentActive(assignment, now)) continue

    const isStoreAssignment = assignment.storeId != null
    const source: "format" | "store" = isStoreAssignment ? "store" : "format"
    const scopeName = assignment.store?.name ?? assignment.format?.name ?? ""
    const scopeId = assignment.storeId ?? assignment.formatId
    if (!scopeId || !scopeName) continue

    for (const placement of assignment.planogramVersion.placements) {
      const directStoreAssortment =
        assignment.storeId != null
          ? storeAssortmentByProduct.get(`${assignment.storeId}:${placement.productId}`)
          : undefined
      const inheritedFormatAssortment =
        assignment.formatId != null
          ? formatAssortmentByProduct.get(`${assignment.formatId}:${placement.productId}`)
          : assignment.store?.formatId
            ? formatAssortmentByProduct.get(`${assignment.store.formatId}:${placement.productId}`)
            : undefined
      const assortment = directStoreAssortment ?? inheritedFormatAssortment
      const reason = obsoleteReasonForAssortment(placement.product, assortment, now)
      if (!reason) continue

      const key = `${assignment.id}:${placement.productId}`
      const existing = rowsByKey.get(key)
      if (existing) {
        existing.placements += 1
        continue
      }
      rowsByKey.set(key, {
        key,
        source,
        scopeName,
        planogramId: assignment.planogramVersion.planogram.id,
        versionId: assignment.planogramVersion.id,
        planogramName: assignment.planogramVersion.planogram.name,
        versionNumber: assignment.planogramVersion.versionNumber,
        productId: placement.productId,
        sku: placement.product.sku,
        productName: placement.product.name,
        brand: placement.product.brand?.name ?? null,
        category: placement.product.category?.name ?? null,
        placements: 1,
        reason,
      })
    }
  }

  return [...rowsByKey.values()].sort((a, b) => {
    const scope = a.scopeName.localeCompare(b.scopeName)
    if (scope !== 0) return scope
    const planogram = a.planogramName.localeCompare(b.planogramName)
    if (planogram !== 0) return planogram
    return a.sku.localeCompare(b.sku)
  })
}

function emptyTaskGroup(key: string, label: string): TaskKpiGroupRow {
  return {
    key,
    label,
    total: 0,
    open: 0,
    completed: 0,
    expired: 0,
    photoSubmissions: 0,
    completionRate: 0,
  }
}

function finalizeTaskGroups(groups: Map<string, TaskKpiGroupRow>): TaskKpiGroupRow[] {
  return [...groups.values()]
    .map((row) => ({
      ...row,
      completionRate: row.total > 0 ? row.completed / row.total : 0,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

export async function getTaskKpiReport(db: TenantDb, now = new Date()): Promise<TaskKpiReport> {
  const tasks = await db.task.findMany({
    include: {
      store: { select: { id: true, name: true, code: true } },
      planogramVersion: {
        select: {
          id: true,
          versionNumber: true,
          planogram: { select: { id: true, name: true } },
        },
      },
      _count: { select: { photoSubmissions: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 5000,
  })

  const summary: TaskKpiSummary = {
    total: 0,
    open: 0,
    completed: 0,
    expired: 0,
    photoSubmitted: 0,
    overdueOpen: 0,
    unassignedOpen: 0,
    photoSubmissions: 0,
    completionRate: 0,
    onTimeRate: null,
    avgCompletionHours: null,
  }
  const stores = new Map<string, TaskKpiGroupRow>()
  const planograms = new Map<string, TaskKpiGroupRow>()
  let completedWithDue = 0
  let completedOnTime = 0
  let completionHoursTotal = 0
  let completionHoursCount = 0

  for (const task of tasks) {
    const isOpen = OPEN_TASK_STATUSES.has(task.status)
    const isCompleted = task.status === "COMPLETED"
    const isExpired = task.status === "EXPIRED"
    const photoCount = task._count.photoSubmissions

    summary.total += 1
    summary.photoSubmissions += photoCount
    if (isOpen) summary.open += 1
    if (isCompleted) summary.completed += 1
    if (isExpired) summary.expired += 1
    if (task.status === "PHOTO_SUBMITTED") summary.photoSubmitted += 1
    if (isOpen && task.dueAt && task.dueAt < now) summary.overdueOpen += 1
    if (isOpen && task.assigneeId == null) summary.unassignedOpen += 1
    if (isCompleted && task.completedAt) {
      completionHoursTotal += (task.completedAt.getTime() - task.createdAt.getTime()) / 3_600_000
      completionHoursCount += 1
      if (task.dueAt) {
        completedWithDue += 1
        if (task.completedAt <= task.dueAt) completedOnTime += 1
      }
    }

    const storeLabel = task.store.code ? `${task.store.name} (${task.store.code})` : task.store.name
    const store = stores.get(task.storeId) ?? emptyTaskGroup(task.storeId, storeLabel)
    store.total += 1
    store.photoSubmissions += photoCount
    if (isOpen) store.open += 1
    if (isCompleted) store.completed += 1
    if (isExpired) store.expired += 1
    stores.set(task.storeId, store)

    if (task.planogramVersion) {
      const key = task.planogramVersion.id
      const label = `${task.planogramVersion.planogram.name} · v${task.planogramVersion.versionNumber}`
      const planogram = planograms.get(key) ?? emptyTaskGroup(key, label)
      planogram.total += 1
      planogram.photoSubmissions += photoCount
      if (isOpen) planogram.open += 1
      if (isCompleted) planogram.completed += 1
      if (isExpired) planogram.expired += 1
      planograms.set(key, planogram)
    }
  }

  summary.completionRate = summary.total > 0 ? summary.completed / summary.total : 0
  summary.onTimeRate = completedWithDue > 0 ? completedOnTime / completedWithDue : null
  summary.avgCompletionHours =
    completionHoursCount > 0 ? completionHoursTotal / completionHoursCount : null

  return {
    summary,
    stores: finalizeTaskGroups(stores),
    planograms: finalizeTaskGroups(planograms),
  }
}
