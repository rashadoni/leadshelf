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

export type BasicDashboardSummary = {
  storesWithPlanograms: number
  activePlanograms: number
}

export type LikeForLikeMetric = "turnover" | "profit" | "quantity"

export type LikeForLikeMetricRow = {
  metric: LikeForLikeMetric
  current: number
  previous: number
  delta: number
  deltaPct: number | null
}

export type LikeForLikeSummary = {
  days: number
  currentStart: string
  currentEnd: string
  previousStart: string
  previousEnd: string
  rows: LikeForLikeMetricRow[]
}

export type LikeForLikeBreakdownGroup = "store" | "format" | "planogram"

export type LikeForLikeBreakdownRow = {
  key: string
  group: LikeForLikeBreakdownGroup
  label: string
  currentTurnover: number
  previousTurnover: number
  currentProfit: number
  previousProfit: number
  currentQuantity: number
  previousQuantity: number
  turnoverDeltaPct: number | null
}

export type LikeForLikeBreakdown = Record<LikeForLikeBreakdownGroup, LikeForLikeBreakdownRow[]>

export type Phase8MetricKey =
  | "turnover"
  | "profit"
  | "quantity"
  | "turnoverPerMeter"
  | "profitPerMeter"
  | "stockDays"
  | "turnoverRatio"

export type Phase8MetricRow = {
  key: Phase8MetricKey
  value: number | null
}

export type SpaceProductivityRow = {
  productId: string
  sku: string
  productName: string
  brand: string | null
  category: string | null
  linearMm: number
  turnover: number
  profit: number
  shelfShare: number
  salesShare: number
  profitShare: number
  salesGap: number
  profitGap: number
}

export type ShelfShareDimension = "brand" | "category" | "supplier"

export type ShelfShareGroupRow = {
  label: string
  productCount: number
  linearMm: number
  shelfShare: number
}

export type ShelfShareGroup = {
  dimension: ShelfShareDimension
  rows: ShelfShareGroupRow[]
}

export function formatMeters(mm: number): string {
  return (mm / 1000).toFixed(2)
}

export function getPhase8MetricRows(input: {
  likeForLikeSummary: LikeForLikeSummary
  totalLinearMm: number
  stockCoverageByProduct: Map<string, StockCoverage>
  productIds: string[]
}): Phase8MetricRow[] {
  const likeForLikeMetricByKey = new Map(input.likeForLikeSummary.rows.map((row) => [row.metric, row]))
  const currentTurnover = likeForLikeMetricByKey.get("turnover")?.current ?? 0
  const previousTurnover = likeForLikeMetricByKey.get("turnover")?.previous ?? 0
  const currentProfit = likeForLikeMetricByKey.get("profit")?.current ?? 0
  const currentQuantity = likeForLikeMetricByKey.get("quantity")?.current ?? 0
  const linearMeters = input.totalLinearMm / 1000
  const stockDayValues = [...new Set(input.productIds)]
    .map((productId) => input.stockCoverageByProduct.get(productId)?.stockDays ?? null)
    .filter((value): value is number => value != null)
  const avgStockDays =
    stockDayValues.length > 0
      ? stockDayValues.reduce((sum, value) => sum + value, 0) / stockDayValues.length
      : null

  return [
    { key: "turnover", value: currentTurnover },
    { key: "profit", value: currentProfit },
    { key: "quantity", value: currentQuantity },
    { key: "turnoverPerMeter", value: linearMeters > 0 ? currentTurnover / linearMeters : null },
    { key: "profitPerMeter", value: linearMeters > 0 ? currentProfit / linearMeters : null },
    { key: "stockDays", value: avgStockDays },
    { key: "turnoverRatio", value: previousTurnover !== 0 ? currentTurnover / previousTurnover : null },
  ]
}

export function getSpaceProductivityRows(
  rows: ProductRow[],
  abcRows: AbcRow[],
  limit = 15,
): SpaceProductivityRow[] {
  const abcByProductId = new Map(abcRows.map((row) => [row.productId, row]))
  const productShareRows = [
    ...rows
      .reduce((map, row) => {
        const existing = map.get(row.productId)
        if (existing) {
          existing.linearMm += row.linearMm
        } else {
          const sales = abcByProductId.get(row.productId)
          map.set(row.productId, {
            productId: row.productId,
            sku: row.sku,
            productName: row.productName,
            brand: row.brand,
            category: row.category,
            linearMm: row.linearMm,
            turnover: sales?.turnover ?? 0,
            profit: sales?.profit ?? 0,
          })
        }
        return map
      }, new Map<string, Omit<SpaceProductivityRow, "shelfShare" | "salesShare" | "profitShare" | "salesGap" | "profitGap">>())
      .values(),
  ]
  const totalLinear = productShareRows.reduce((sum, row) => sum + row.linearMm, 0)
  const totalTurnover = productShareRows.reduce((sum, row) => sum + Math.max(0, row.turnover), 0)
  const totalProfit = productShareRows.reduce((sum, row) => sum + Math.max(0, row.profit), 0)

  return productShareRows
    .map((row) => {
      const shelfShare = totalLinear > 0 ? row.linearMm / totalLinear : 0
      const salesShare = totalTurnover > 0 ? Math.max(0, row.turnover) / totalTurnover : 0
      const profitShare = totalProfit > 0 ? Math.max(0, row.profit) / totalProfit : 0
      return {
        ...row,
        shelfShare,
        salesShare,
        profitShare,
        salesGap: salesShare - shelfShare,
        profitGap: profitShare - shelfShare,
      }
    })
    .sort((a, b) => Math.abs(b.salesGap) - Math.abs(a.salesGap) || a.sku.localeCompare(b.sku))
    .slice(0, limit)
}

export function getShelfShareGroups(rows: ProductRow[], emptyLabel: string): ShelfShareGroup[] {
  const totalLinearMm = rows.reduce((sum, row) => sum + row.linearMm, 0)
  return (["brand", "category", "supplier"] as const).map((dimension) => {
    const groupMap = rows.reduce(
      (map, row) => {
        const label = row[dimension] ?? emptyLabel
        const existing = map.get(label)
        if (existing) {
          existing.products.add(row.sku)
          existing.linearMm += row.linearMm
        } else {
          map.set(label, { label, products: new Set([row.sku]), linearMm: row.linearMm })
        }
        return map
      },
      new Map<string, { label: string; products: Set<string>; linearMm: number }>(),
    )
    return {
      dimension,
      rows: [...groupMap.values()]
        .map((row) => ({
          label: row.label,
          productCount: row.products.size,
          linearMm: row.linearMm,
          shelfShare: totalLinearMm > 0 ? row.linearMm / totalLinearMm : 0,
        }))
        .sort((a, b) => b.linearMm - a.linearMm || a.label.localeCompare(b.label))
        .slice(0, 10),
    }
  })
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
type PlanogramPlacementDb = {
  planogramPlacement: {
    findMany(args: unknown): Promise<unknown[]>
  }
}
type PlanogramAssignmentDb = {
  planogramAssignment: {
    findMany(args: unknown): Promise<unknown[]>
  }
  assortmentMatrix: {
    findMany(args: unknown): Promise<unknown[]>
  }
  storeAssortment: {
    findMany(args: unknown): Promise<unknown[]>
  }
}
const OPEN_TASK_STATUSES = new Set(["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"])

type PlanogramProductPlacement = {
  planogramVersionId: string
  productId: string
  facingsX: number
  facingsY: number
  facingsZ: number
  widthMm: number
  compressionX: number
  planogramVersion: {
    id: string
    versionNumber: number
    state: string
    planogram: { id: string; name: string }
  }
  product: {
    id: string
    sku: string
    name: string
    category: { name: string } | null
    brand: { name: string } | null
    supplier: { name: string } | null
  }
}

type ActiveAssignment = {
  activeFrom: Date
  activeTo: Date | null
}

type BasicDashboardAssignment = ActiveAssignment & {
  storeId: string | null
  formatId: string | null
  planogramVersionId: string
}

type AssignmentPlacementRef = {
  productId: string
}

type LikeForLikeAssignment = ActiveAssignment & {
  storeId: string | null
  formatId: string | null
  planogramVersion: {
    id: string
    versionNumber: number
    planogram: { id: string; name: string }
    placements: AssignmentPlacementRef[]
  }
}

type AssortmentGapAssignment = ActiveAssignment & {
  storeId: string | null
  formatId: string | null
  planogramVersion: {
    placements: AssignmentPlacementRef[]
  }
}

type ObsoleteAssignment = ActiveAssignment & {
  id: string
  storeId: string | null
  formatId: string | null
  format: { id: string; name: string } | null
  store: { id: string; name: string; formatId: string | null } | null
  planogramVersion: {
    id: string
    versionNumber: number
    planogram: { id: string; name: string }
    placements: Array<{
      productId: string
      product: {
        id: string
        sku: string
        name: string
        isActive: boolean
        brand: { name: string } | null
        category: { name: string } | null
      }
    }>
  }
}

type AssortmentProduct = {
  id: string
  sku: string
  name: string
  brand: { name: string } | null
  category: { name: string } | null
  supplier: { name: string } | null
}

type FormatAssortmentGapItem = {
  formatId: string
  productId: string
  isActive: boolean
  validFrom: Date | null
  validTo: Date | null
  format: { id: string; name: string }
  product: AssortmentProduct
}

type StoreAssortmentGapItem = {
  storeId: string
  productId: string
  isActive: boolean
  validFrom: Date | null
  validTo: Date | null
  store: { id: string; name: string }
  product: AssortmentProduct
}

type AssortmentStatusItem = {
  productId: string
  isActive: boolean
  validFrom: Date | null
  validTo: Date | null
}

type FormatAssortmentStatusItem = AssortmentStatusItem & {
  formatId: string
}

type StoreAssortmentStatusItem = AssortmentStatusItem & {
  storeId: string
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function getPlanogramProductRows(
  db: PlanogramPlacementDb,
  organizationId: string,
): Promise<ProductRow[]> {
  const placements = (await db.planogramPlacement.findMany({
    where: {
      planogramVersion: {
        state: { in: ["DRAFT", "PUBLISHED"] },
        planogram: { organizationId },
      },
    },
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
  })) as PlanogramProductPlacement[]

  const rowsByKey = new Map<string, ProductRow>()
  for (const placement of placements) {
    const key = `${placement.planogramVersionId}:${placement.productId}`
    const units = placement.facingsX * placement.facingsY * placement.facingsZ
    const linearMm = placement.widthMm * placement.compressionX * placement.facingsX
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

export async function getBasicDashboardSummary(
  db: TenantDb,
  parentDb: PlanogramAssignmentDb,
  organizationId: string,
  now = new Date(),
): Promise<BasicDashboardSummary> {
  const assignments = (await parentDb.planogramAssignment.findMany({
    where: { planogramVersion: { planogram: { organizationId } } },
    select: {
      storeId: true,
      formatId: true,
      planogramVersionId: true,
      activeFrom: true,
      activeTo: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 3000,
  })) as BasicDashboardAssignment[]
  const activeAssignments = assignments.filter((assignment) => isAssignmentActive(assignment, now))
  const directStoreIds = new Set(
    activeAssignments.flatMap((assignment) => (assignment.storeId ? [assignment.storeId] : [])),
  )
  const formatIds = [
    ...new Set(activeAssignments.flatMap((assignment) => (assignment.formatId ? [assignment.formatId] : []))),
  ]
  const formatStores =
    formatIds.length > 0
      ? await db.store.findMany({
          where: { isActive: true, formatId: { in: formatIds } },
          select: { id: true },
          take: 5000,
        })
      : []
  for (const store of formatStores) directStoreIds.add(store.id)

  return {
    storesWithPlanograms: directStoreIds.size,
    activePlanograms: new Set(activeAssignments.map((assignment) => assignment.planogramVersionId)).size,
  }
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

export async function getLikeForLikeSummary(
  db: TenantDb,
  now = new Date(),
  days = 30,
): Promise<LikeForLikeSummary> {
  const currentEnd = addDays(startOfDay(now), 1)
  const currentStart = addDays(currentEnd, -days)
  const previousEnd = currentStart
  const previousStart = addDays(previousEnd, -days)
  const sales = await db.salesSnapshot.findMany({
    where: { date: { gte: previousStart, lt: currentEnd } },
    select: { date: true, quantity: true, revenue: true, profit: true },
    orderBy: [{ date: "asc" }],
    take: 10000,
  })

  const current = { turnover: 0, profit: 0, quantity: 0 }
  const previous = { turnover: 0, profit: 0, quantity: 0 }
  for (const sale of sales) {
    const target = sale.date >= currentStart ? current : previous
    target.turnover += Number(sale.revenue)
    target.profit += sale.profit == null ? 0 : Number(sale.profit)
    target.quantity += Number(sale.quantity)
  }

  const rows = (["turnover", "profit", "quantity"] as const).map((metric) => {
    const currentValue = current[metric]
    const previousValue = previous[metric]
    return {
      metric,
      current: currentValue,
      previous: previousValue,
      delta: currentValue - previousValue,
      deltaPct: previousValue !== 0 ? (currentValue - previousValue) / Math.abs(previousValue) : null,
    }
  })

  return {
    days,
    currentStart: dateKey(currentStart),
    currentEnd: dateKey(addDays(currentEnd, -1)),
    previousStart: dateKey(previousStart),
    previousEnd: dateKey(addDays(previousEnd, -1)),
    rows,
  }
}

function emptyLikeForLikeBreakdownRow(
  key: string,
  group: LikeForLikeBreakdownGroup,
  label: string,
): LikeForLikeBreakdownRow {
  return {
    key,
    group,
    label,
    currentTurnover: 0,
    previousTurnover: 0,
    currentProfit: 0,
    previousProfit: 0,
    currentQuantity: 0,
    previousQuantity: 0,
    turnoverDeltaPct: null,
  }
}

function addSaleToBreakdown(
  map: Map<string, LikeForLikeBreakdownRow>,
  input: { key: string; group: LikeForLikeBreakdownGroup; label: string },
  sale: { revenue: unknown; profit: unknown | null; quantity: unknown },
  isCurrent: boolean,
): void {
  const row = map.get(input.key) ?? emptyLikeForLikeBreakdownRow(input.key, input.group, input.label)
  const turnover = Number(sale.revenue)
  const profit = sale.profit == null ? 0 : Number(sale.profit)
  const quantity = Number(sale.quantity)
  if (isCurrent) {
    row.currentTurnover += turnover
    row.currentProfit += profit
    row.currentQuantity += quantity
  } else {
    row.previousTurnover += turnover
    row.previousProfit += profit
    row.previousQuantity += quantity
  }
  map.set(input.key, row)
}

function finalizeLikeForLikeBreakdown(
  rows: Map<string, LikeForLikeBreakdownRow>,
): LikeForLikeBreakdownRow[] {
  return [...rows.values()]
    .map((row) => ({
      ...row,
      turnoverDeltaPct:
        row.previousTurnover !== 0
          ? (row.currentTurnover - row.previousTurnover) / Math.abs(row.previousTurnover)
          : null,
    }))
    .sort((a, b) => b.currentTurnover - a.currentTurnover || a.label.localeCompare(b.label))
    .slice(0, 10)
}

export async function getLikeForLikeBreakdown(
  db: TenantDb,
  parentDb: PlanogramAssignmentDb,
  organizationId: string,
  now = new Date(),
  days = 30,
): Promise<LikeForLikeBreakdown> {
  const currentEnd = addDays(startOfDay(now), 1)
  const currentStart = addDays(currentEnd, -days)
  const previousStart = addDays(currentStart, -days)
  const [sales, assignments] = await Promise.all([
    db.salesSnapshot.findMany({
      where: { date: { gte: previousStart, lt: currentEnd }, storeId: { not: null } },
      select: {
        date: true,
        productId: true,
        quantity: true,
        revenue: true,
        profit: true,
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            format: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: "asc" }],
      take: 15000,
    }),
    parentDb.planogramAssignment.findMany({
      where: { planogramVersion: { planogram: { organizationId } } },
      include: {
        store: { select: { id: true, name: true, code: true } },
        format: { select: { id: true } },
        planogramVersion: {
          select: {
            id: true,
            versionNumber: true,
            planogram: { select: { id: true, name: true } },
            placements: { select: { productId: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 3000,
    }) as Promise<LikeForLikeAssignment[]>,
  ])
  const formatIds = [
    ...new Set(
      assignments.flatMap((assignment) =>
        assignment.formatId && isAssignmentActive(assignment, now) ? [assignment.formatId] : [],
      ),
    ),
  ]
  const formatStores =
    formatIds.length > 0
      ? await db.store.findMany({
          where: { isActive: true, formatId: { in: formatIds } },
          select: { id: true, formatId: true },
          take: 5000,
        })
      : []
  const storesByFormat = new Map<string, string[]>()
  for (const store of formatStores) {
    if (!store.formatId) continue
    storesByFormat.set(store.formatId, [...(storesByFormat.get(store.formatId) ?? []), store.id])
  }

  const planogramsByStore = new Map<
    string,
    Array<{ key: string; label: string; productIds: Set<string> }>
  >()
  for (const assignment of assignments) {
    if (!isAssignmentActive(assignment, now)) continue
    const productIds = new Set(assignment.planogramVersion.placements.map((placement) => placement.productId))
    const label = `${assignment.planogramVersion.planogram.name} · v${assignment.planogramVersion.versionNumber}`
    const targets = assignment.storeId
      ? [assignment.storeId]
      : assignment.formatId
        ? (storesByFormat.get(assignment.formatId) ?? [])
        : []
    for (const storeId of targets) {
      planogramsByStore.set(storeId, [
        ...(planogramsByStore.get(storeId) ?? []),
        { key: assignment.planogramVersion.id, label, productIds },
      ])
    }
  }

  const byStore = new Map<string, LikeForLikeBreakdownRow>()
  const byFormat = new Map<string, LikeForLikeBreakdownRow>()
  const byPlanogram = new Map<string, LikeForLikeBreakdownRow>()
  for (const sale of sales) {
    if (!sale.store) continue
    const isCurrent = sale.date >= currentStart
    const storeLabel = sale.store.code ? `${sale.store.name} (${sale.store.code})` : sale.store.name
    addSaleToBreakdown(byStore, { key: sale.store.id, group: "store", label: storeLabel }, sale, isCurrent)

    if (sale.store.format) {
      addSaleToBreakdown(
        byFormat,
        { key: sale.store.format.id, group: "format", label: sale.store.format.name },
        sale,
        isCurrent,
      )
    }

    for (const planogram of planogramsByStore.get(sale.store.id) ?? []) {
      if (!planogram.productIds.has(sale.productId)) continue
      addSaleToBreakdown(
        byPlanogram,
        { key: planogram.key, group: "planogram", label: planogram.label },
        sale,
        isCurrent,
      )
    }
  }

  return {
    store: finalizeLikeForLikeBreakdown(byStore),
    format: finalizeLikeForLikeBreakdown(byFormat),
    planogram: finalizeLikeForLikeBreakdown(byPlanogram),
  }
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

export async function getAssortmentGapRows(
  db: TenantDb,
  parentDb: PlanogramAssignmentDb,
  organizationId: string,
  now = new Date(),
): Promise<AssortmentGapRow[]> {
  const [formatAssortment, storeAssortment, assignments] = await Promise.all([
    parentDb.assortmentMatrix.findMany({
      where: { isActive: true, format: { organizationId } },
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
    }) as Promise<FormatAssortmentGapItem[]>,
    parentDb.storeAssortment.findMany({
      where: { isActive: true, store: { organizationId } },
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
    }) as Promise<StoreAssortmentGapItem[]>,
    parentDb.planogramAssignment.findMany({
      where: { planogramVersion: { planogram: { organizationId } } },
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
    }) as Promise<AssortmentGapAssignment[]>,
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
  parentDb: PlanogramAssignmentDb,
  organizationId: string,
  now = new Date(),
): Promise<ObsoletePlanogramRow[]> {
  const [formatAssortment, storeAssortment, assignments] = await Promise.all([
    parentDb.assortmentMatrix.findMany({
      where: { format: { organizationId } },
      select: {
        formatId: true,
        productId: true,
        isActive: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: [{ formatId: "asc" }, { productId: "asc" }],
      take: 5000,
    }) as Promise<FormatAssortmentStatusItem[]>,
    parentDb.storeAssortment.findMany({
      where: { store: { organizationId } },
      select: {
        storeId: true,
        productId: true,
        isActive: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: [{ storeId: "asc" }, { productId: "asc" }],
      take: 5000,
    }) as Promise<StoreAssortmentStatusItem[]>,
    parentDb.planogramAssignment.findMany({
      where: { planogramVersion: { planogram: { organizationId } } },
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
    }) as Promise<ObsoleteAssignment[]>,
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
