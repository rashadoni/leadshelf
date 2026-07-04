import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import { getSession } from "@/server/auth/require-session"
import { tenantDb, workerDb } from "@/server/db/client"
import {
  filterRowsByPlanogramVersions,
  formatMeters,
  getAssortmentGapRows,
  getAbcRows,
  getBasicDashboardSummary,
  getLikeForLikeBreakdown,
  getLikeForLikeSummary,
  getPhase8MetricRows,
  getObsoletePlanogramRows,
  getPlanogramProductRows,
  getShelfShareGroups,
  getSpaceProductivityRows,
  getStockCoverageByProduct,
  getTaskKpiReport,
  type AbcClass,
  type Phase8MetricRow,
} from "@/server/analytics/planogram-products"

type GroupRow = {
  key: string
  label: string
  products: Set<string>
  placements: number
  units: number
  linearMm: number
}

const OPTIONAL_COLUMNS = ["brand", "category", "supplier", "placements", "units", "linearMeters"] as const
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]
const GROUP_COLUMNS = ["brand", "category", "supplier"] as const
type GroupColumn = (typeof GROUP_COLUMNS)[number]
const COLOR_MODES = ["brand", "supplier", "markup", "stockDays"] as const
type ColorMode = (typeof COLOR_MODES)[number]

function parseVisibleColumns(raw: string | undefined): Set<OptionalColumn> {
  if (!raw) return new Set(OPTIONAL_COLUMNS)
  const requested = new Set(raw.split(",").filter((v): v is OptionalColumn => {
    return OPTIONAL_COLUMNS.includes(v as OptionalColumn)
  }))
  return requested.size > 0 ? requested : new Set(OPTIONAL_COLUMNS)
}

function formatAmount(value: number): string {
  return value.toFixed(2)
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatPhase8MetricValue(metric: Phase8MetricRow): string {
  if (metric.value == null) return "—"
  if (metric.key === "stockDays") return metric.value.toFixed(1)
  if (metric.key === "turnoverRatio") return metric.value.toFixed(2)
  return formatAmount(metric.value)
}

function deltaClass(value: number): string {
  if (value > 0) return "text-green-700"
  if (value < 0) return "text-red-600"
  return "text-neutral-600"
}

function abcBadgeClass(value: AbcClass): string {
  if (value === "A") return "bg-green-50 text-green-700"
  if (value === "B") return "bg-amber-50 text-amber-700"
  return "bg-neutral-100 text-neutral-600"
}

function colorSwatchClass(index: number): string {
  const colors = [
    "bg-sky-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-lime-600",
    "bg-fuchsia-500",
  ]
  return colors[index % colors.length]!
}

function parseGroup(raw: string | undefined): GroupColumn | null {
  return GROUP_COLUMNS.includes(raw as GroupColumn) ? (raw as GroupColumn) : null
}

function parseColorMode(raw: string | undefined): ColorMode {
  return COLOR_MODES.includes(raw as ColorMode) ? (raw as ColorMode) : "brand"
}

function analyticsHref(
  visibleColumns: Set<OptionalColumn>,
  groupBy: GroupColumn | null,
  colorMode: ColorMode,
): string {
  const params = new URLSearchParams()
  const cols = OPTIONAL_COLUMNS.filter((c) => visibleColumns.has(c))
  if (cols.length !== OPTIONAL_COLUMNS.length) params.set("cols", cols.join(","))
  if (groupBy) params.set("group", groupBy)
  if (colorMode !== "brand") params.set("color", colorMode)
  const query = params.toString()
  return query ? `/analytics?${query}` : "/analytics"
}

function columnHref(
  column: OptionalColumn,
  visibleColumns: Set<OptionalColumn>,
  groupBy: GroupColumn | null,
  colorMode: ColorMode,
): string {
  const next = new Set(visibleColumns)
  if (next.has(column)) {
    next.delete(column)
  } else {
    next.add(column)
  }
  return analyticsHref(next, groupBy, colorMode)
}

function groupHref(
  groupBy: GroupColumn | null,
  visibleColumns: Set<OptionalColumn>,
  colorMode: ColorMode,
): string {
  return analyticsHref(visibleColumns, groupBy, colorMode)
}

function colorHref(
  colorMode: ColorMode,
  visibleColumns: Set<OptionalColumn>,
  groupBy: GroupColumn | null,
): string {
  return analyticsHref(visibleColumns, groupBy, colorMode)
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const [t, tNav, session, params] = await Promise.all([
    getTranslations("analytics"),
    getTranslations("nav"),
    getSession(),
    searchParams,
  ])
  if (!session) return null
  const visibleColumns = parseVisibleColumns(params.cols)
  const groupBy = parseGroup(params.group)
  const colorMode = parseColorMode(params.color)

  const db = tenantDb(session.org)
  const [
    rows,
    abcRows,
    assortmentGapRows,
    obsoletePlanogramRows,
    taskKpiReport,
    basicDashboardSummary,
    likeForLikeSummary,
    likeForLikeBreakdown,
  ] = await Promise.all([
    getPlanogramProductRows(workerDb, session.org),
    getAbcRows(db),
    getAssortmentGapRows(db, workerDb, session.org),
    getObsoletePlanogramRows(db, workerDb, session.org),
    getTaskKpiReport(db),
    getBasicDashboardSummary(db, workerDb, session.org),
    getLikeForLikeSummary(db),
    getLikeForLikeBreakdown(db, workerDb, session.org),
  ])
  const stockCoverageByProduct = await getStockCoverageByProduct(
    db,
    rows.map((row) => row.productId),
  )
  const abcByProductId = new Map(abcRows.map((row) => [row.productId, row]))
  const activePlanogramRows = filterRowsByPlanogramVersions(
    rows,
    basicDashboardSummary.activePlanogramVersionIds,
  )
  const activeLinearMm = activePlanogramRows.reduce((sum, r) => sum + r.linearMm, 0)
  const phase8Metrics = getPhase8MetricRows({
    likeForLikeSummary,
    totalLinearMm: activeLinearMm,
    stockCoverageByProduct,
    productIds: activePlanogramRows.map((row) => row.productId),
  })
  const spaceProductivityRows = getSpaceProductivityRows(activePlanogramRows, abcRows)
  const shelfShareGroups = getShelfShareGroups(activePlanogramRows, t("grouping.empty"))
  const groupRows = groupBy
    ? [
        ...rows
          .reduce((map, row) => {
            const label = row[groupBy] ?? t("grouping.empty")
            const existing = map.get(label)
            if (existing) {
              existing.products.add(row.sku)
              existing.placements += row.placements
              existing.units += row.units
              existing.linearMm += row.linearMm
            } else {
              map.set(label, {
                key: label,
                label,
                products: new Set([row.sku]),
                placements: row.placements,
                units: row.units,
                linearMm: row.linearMm,
              })
            }
            return map
          }, new Map<string, GroupRow>())
          .values(),
      ].sort((a, b) => b.linearMm - a.linearMm || a.label.localeCompare(b.label))
    : []
  const salesBySku = new Map(abcRows.map((row) => [row.sku, row.turnover]))
  const heatmapRows = rows
    .map((row) => ({
      key: row.key,
      planogramId: row.planogramId,
      versionId: row.versionId,
      planogramName: row.planogramName,
      versionNumber: row.versionNumber,
      sku: row.sku,
      productName: row.productName,
      turnover: salesBySku.get(row.sku) ?? 0,
      linearMm: row.linearMm,
    }))
    .filter((row) => row.turnover > 0)
    .sort((a, b) => {
      const planogram = a.planogramName.localeCompare(b.planogramName)
      if (planogram !== 0) return planogram
      return b.turnover - a.turnover
    })
  const maxHeatmapTurnover = Math.max(0, ...heatmapRows.map((row) => row.turnover))
  const categoryColorIndexes = new Map<string, number>()
  const colorRows = rows.map((row) => {
    const sales = abcByProductId.get(row.productId)
    const coverage = stockCoverageByProduct.get(row.productId)
    let label = ""
    let value = ""
    let swatchClass = "bg-neutral-400"

    if (colorMode === "brand" || colorMode === "supplier") {
      label = row[colorMode] ?? t("grouping.empty")
      if (!categoryColorIndexes.has(label)) categoryColorIndexes.set(label, categoryColorIndexes.size)
      swatchClass = colorSwatchClass(categoryColorIndexes.get(label) ?? 0)
      value = label
    } else if (colorMode === "markup") {
      const markup = sales && sales.turnover > 0 ? (sales.profit / sales.turnover) * 100 : null
      if (markup == null) {
        label = t("colorOverlay.noData")
        value = "—"
        swatchClass = "bg-neutral-400"
      } else if (markup < 0) {
        label = t("colorOverlay.markup.negative")
        value = `${markup.toFixed(1)}%`
        swatchClass = "bg-red-600"
      } else if (markup < 10) {
        label = t("colorOverlay.markup.low")
        value = `${markup.toFixed(1)}%`
        swatchClass = "bg-amber-500"
      } else if (markup < 25) {
        label = t("colorOverlay.markup.medium")
        value = `${markup.toFixed(1)}%`
        swatchClass = "bg-emerald-500"
      } else {
        label = t("colorOverlay.markup.high")
        value = `${markup.toFixed(1)}%`
        swatchClass = "bg-green-700"
      }
    } else {
      const stockDays = coverage?.stockDays ?? null
      if (stockDays == null) {
        label = t("colorOverlay.noData")
        value = "—"
        swatchClass = "bg-neutral-400"
      } else if (stockDays < 7) {
        label = t("colorOverlay.stockDays.low")
        value = stockDays.toFixed(1)
        swatchClass = "bg-red-600"
      } else if (stockDays <= 21) {
        label = t("colorOverlay.stockDays.ok")
        value = stockDays.toFixed(1)
        swatchClass = "bg-emerald-500"
      } else {
        label = t("colorOverlay.stockDays.high")
        value = stockDays.toFixed(1)
        swatchClass = "bg-sky-600"
      }
    }

    return { ...row, label, value, swatchClass }
  })

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{tNav("analytics")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">{t("subtitle")}</p>
        </div>
        <a
          href="/api/v1/analytics/planogram-products/export"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          {t("exportExcel")}
        </a>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {[
          [t("kpi.storesWithPlanograms"), basicDashboardSummary.storesWithPlanograms],
          [t("kpi.activePlanograms"), basicDashboardSummary.activePlanograms],
          [t("kpi.products"), basicDashboardSummary.placedSkus],
          [t("kpi.linearMeters"), formatMeters(basicDashboardSummary.linearMm)],
          [t("kpi.turnover"), formatAmount(basicDashboardSummary.turnover)],
          [t("kpi.profit"), formatAmount(basicDashboardSummary.profit)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("likeForLike.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {t("likeForLike.hint", {
              days: likeForLikeSummary.days,
              currentStart: likeForLikeSummary.currentStart,
              currentEnd: likeForLikeSummary.currentEnd,
              previousStart: likeForLikeSummary.previousStart,
              previousEnd: likeForLikeSummary.previousEnd,
            })}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2">{t("likeForLike.columns.metric")}</th>
                <th className="px-3 py-2 text-right">{t("likeForLike.columns.current")}</th>
                <th className="px-3 py-2 text-right">{t("likeForLike.columns.previous")}</th>
                <th className="px-3 py-2 text-right">{t("likeForLike.columns.delta")}</th>
                <th className="px-3 py-2 text-right">{t("likeForLike.columns.deltaPct")}</th>
              </tr>
            </thead>
            <tbody>
              {likeForLikeSummary.rows.map((row) => (
                <tr key={row.metric} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2 font-medium">{t(`likeForLike.metrics.${row.metric}` as never)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.current)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.previous)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(row.delta)}`}>
                    {formatAmount(row.delta)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(row.delta)}`}>
                    {row.deltaPct == null ? "—" : formatPercent(row.deltaPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 border-t border-neutral-200 p-3 xl:grid-cols-3">
          {(["store", "format", "planogram"] as const).map((group) => (
            <div key={group} className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                    <th className="px-3 py-2">{t(`likeForLike.groups.${group}` as never)}</th>
                    <th className="px-3 py-2 text-right">{t("likeForLike.columns.currentTurnover")}</th>
                    <th className="px-3 py-2 text-right">{t("likeForLike.columns.previousTurnover")}</th>
                    <th className="px-3 py-2 text-right">{t("likeForLike.columns.deltaPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {likeForLikeBreakdown[group].length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-sm text-neutral-500" colSpan={4}>
                        {t("likeForLike.emptyBreakdown")}
                      </td>
                    </tr>
                  ) : (
                    likeForLikeBreakdown[group].map((row) => (
                      <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(row.currentTurnover)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(row.previousTurnover)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${deltaClass(row.currentTurnover - row.previousTurnover)}`}
                        >
                          {row.turnoverDeltaPct == null ? "—" : formatPercent(row.turnoverDeltaPct)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("phase8Metrics.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("phase8Metrics.hint")}</p>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {phase8Metrics.map((metric) => (
            <div key={metric.key} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
              <div className="text-xs text-neutral-500">
                {t(`phase8Metrics.items.${metric.key}` as never)}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatPhase8MetricValue(metric)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("spaceProductivity.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("spaceProductivity.hint")}</p>
        </div>
        {spaceProductivityRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("productTable.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  <th className="px-3 py-2 text-right">{t("spaceProductivity.columns.shelfShare")}</th>
                  <th className="px-3 py-2 text-right">{t("spaceProductivity.columns.salesShare")}</th>
                  <th className="px-3 py-2 text-right">{t("spaceProductivity.columns.profitShare")}</th>
                  <th className="px-3 py-2 text-right">{t("spaceProductivity.columns.salesGap")}</th>
                  <th className="px-3 py-2 text-right">{t("spaceProductivity.columns.profitGap")}</th>
                </tr>
              </thead>
              <tbody>
                {spaceProductivityRows.map((row) => (
                  <tr key={row.productId} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.shelfShare)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.salesShare)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.profitShare)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(row.salesGap)}`}>
                      {formatPercent(row.salesGap)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(row.profitGap)}`}>
                      {formatPercent(row.profitGap)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("shelfShare.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("shelfShare.hint")}</p>
        </div>
        <div className="grid gap-4 p-3 xl:grid-cols-3">
          {shelfShareGroups.map((group) => (
            <div key={group.dimension} className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                    <th className="px-3 py-2">{t(`productTable.columns.${group.dimension}` as never)}</th>
                    <th className="px-3 py-2 text-right">{t("shelfShare.columns.products")}</th>
                    <th className="px-3 py-2 text-right">{t("productTable.columns.linearMeters")}</th>
                    <th className="px-3 py-2 text-right">{t("shelfShare.columns.share")}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-sm text-neutral-500" colSpan={4}>
                        {t("productTable.empty")}
                      </td>
                    </tr>
                  ) : (
                    group.rows.map((row) => (
                      <tr key={row.label} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.productCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMeters(row.linearMm)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.shelfShare)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase text-neutral-500">
            {t("columnChooser.title")}
          </span>
          <Link href="/analytics" className="text-xs text-neutral-500 hover:underline">
            {t("columnChooser.reset")}
          </Link>
        </div>
        <div className="flex flex-wrap gap-1">
          {OPTIONAL_COLUMNS.map((column) => {
            const active = visibleColumns.has(column)
            return (
              <Link
                key={column}
                href={columnHref(column, visibleColumns, groupBy, colorMode)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  active
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600"
                }`}
              >
                {t(`productTable.columns.${column}` as never)}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2">
        <div className="mb-2 text-xs font-semibold uppercase text-neutral-500">
          {t("grouping.title")}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link
            href={groupHref(null, visibleColumns, colorMode)}
            className={`rounded-full border px-3 py-1 text-xs ${
              !groupBy
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600"
            }`}
          >
            {t("grouping.none")}
          </Link>
          {GROUP_COLUMNS.map((column) => (
            <Link
              key={column}
              href={groupHref(column, visibleColumns, colorMode)}
              className={`rounded-full border px-3 py-1 text-xs ${
                groupBy === column
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600"
              }`}
            >
              {t(`productTable.columns.${column}` as never)}
            </Link>
          ))}
        </div>
      </div>

      {groupBy ? (
        <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="font-semibold">{t("grouping.summaryTitle")}</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {t("grouping.summaryHint", {
                column: t(`productTable.columns.${groupBy}` as never),
              })}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t(`productTable.columns.${groupBy}` as never)}</th>
                  <th className="px-3 py-2 text-right">{t("grouping.products")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.placements")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.units")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.linearMeters")}</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.products.size}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.placements}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.units}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMeters(row.linearMm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("abc.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("abc.hint")}</p>
        </div>
        {abcRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("abc.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  <th className="px-3 py-2 text-right">{t("abc.columns.turnover")}</th>
                  <th className="px-3 py-2 text-right">{t("abc.columns.cost")}</th>
                  <th className="px-3 py-2 text-right">{t("abc.columns.profit")}</th>
                  <th className="px-3 py-2 text-right">{t("abc.columns.quantity")}</th>
                </tr>
              </thead>
              <tbody>
                {abcRows.map((row) => (
                  <tr key={row.productId} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    {(["turnover", "cost", "profit", "quantity"] as const).map((metric) => (
                      <td key={metric} className="px-3 py-2 text-right tabular-nums">
                        <div>{formatAmount(row[metric])}</div>
                        <span
                          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${abcBadgeClass(row.classes[metric])}`}
                        >
                          {row.classes[metric]}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("colorOverlay.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("colorOverlay.hint")}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {COLOR_MODES.map((mode) => (
              <Link
                key={mode}
                href={colorHref(mode, visibleColumns, groupBy)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  colorMode === mode
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-600"
                }`}
              >
                {t(`colorOverlay.modes.${mode}` as never)}
              </Link>
            ))}
          </div>
        </div>
        {colorRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("productTable.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("productTable.columns.planogram")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2">{t("colorOverlay.color")}</th>
                  <th className="px-3 py-2">{t("colorOverlay.value")}</th>
                </tr>
              </thead>
              <tbody>
                {colorRows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/planograms/${row.planogramId}/${row.versionId}`}
                        className="font-medium hover:underline"
                      >
                        {row.planogramName}
                      </Link>
                      <div className="mt-0.5 text-xs text-neutral-500">v{row.versionNumber}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`mr-2 inline-block h-3 w-3 rounded-full ${row.swatchClass}`} />
                      {row.label}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("heatmap.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("heatmap.hint")}</p>
        </div>
        {heatmapRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("heatmap.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("productTable.columns.planogram")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2 text-right">{t("abc.columns.turnover")}</th>
                  <th className="px-3 py-2">{t("heatmap.intensity")}</th>
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map((row) => {
                  const pct = maxHeatmapTurnover > 0 ? Math.max(4, (row.turnover / maxHeatmapTurnover) * 100) : 0
                  return (
                    <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                      <td className="px-3 py-2">
                        <Link
                          href={`/planograms/${row.planogramId}/${row.versionId}`}
                          className="font-medium hover:underline"
                        >
                          {row.planogramName}
                        </Link>
                        <div className="mt-0.5 text-xs text-neutral-500">v{row.versionNumber}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.productName}</div>
                        <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.turnover)}</td>
                      <td className="min-w-[180px] px-3 py-2">
                        <div className="h-3 rounded bg-neutral-100">
                          <div className="h-3 rounded bg-emerald-600" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("assortmentGaps.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("assortmentGaps.hint")}</p>
        </div>
        {assortmentGapRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("assortmentGaps.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("assortmentGaps.columns.scope")}</th>
                  <th className="px-3 py-2">{t("assortmentGaps.columns.source")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.category")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.supplier")}</th>
                </tr>
              </thead>
              <tbody>
                {assortmentGapRows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2 font-medium">{row.scopeName}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {t(`assortmentGaps.source.${row.source}` as never)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.category ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.supplier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("obsoletePlanogram.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("obsoletePlanogram.hint")}</p>
        </div>
        {obsoletePlanogramRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("obsoletePlanogram.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("assortmentGaps.columns.scope")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.planogram")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.category")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.placements")}</th>
                  <th className="px-3 py-2">{t("obsoletePlanogram.columns.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {obsoletePlanogramRows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.scopeName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {t(`assortmentGaps.source.${row.source}` as never)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/planograms/${row.planogramId}/${row.versionId}`}
                        className="font-medium hover:underline"
                      >
                        {row.planogramName}
                      </Link>
                      <div className="mt-0.5 text-xs text-neutral-500">v{row.versionNumber}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.category ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.placements}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {t(`obsoletePlanogram.reason.${row.reason}` as never)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("taskKpi.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("taskKpi.hint")}</p>
        </div>
        <div className="grid gap-2 border-b border-neutral-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t("taskKpi.cards.total"), taskKpiReport.summary.total],
            [t("taskKpi.cards.open"), taskKpiReport.summary.open],
            [t("taskKpi.cards.completed"), taskKpiReport.summary.completed],
            [t("taskKpi.cards.expired"), taskKpiReport.summary.expired],
            [t("taskKpi.cards.photoSubmitted"), taskKpiReport.summary.photoSubmitted],
            [t("taskKpi.cards.overdueOpen"), taskKpiReport.summary.overdueOpen],
            [t("taskKpi.cards.unassignedOpen"), taskKpiReport.summary.unassignedOpen],
            [t("taskKpi.cards.photoSubmissions"), taskKpiReport.summary.photoSubmissions],
            [t("taskKpi.cards.completionRate"), formatPercent(taskKpiReport.summary.completionRate)],
            [
              t("taskKpi.cards.onTimeRate"),
              taskKpiReport.summary.onTimeRate == null ? "—" : formatPercent(taskKpiReport.summary.onTimeRate),
            ],
            [
              t("taskKpi.cards.avgCompletionHours"),
              taskKpiReport.summary.avgCompletionHours == null
                ? "—"
                : taskKpiReport.summary.avgCompletionHours.toFixed(1),
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
              <div className="text-xs text-neutral-500">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        {taskKpiReport.summary.total === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("taskKpi.empty")}</div>
        ) : (
          <div className="grid gap-4 p-3 lg:grid-cols-2">
            {[
              [t("taskKpi.byStore"), taskKpiReport.stores],
              [t("taskKpi.byPlanogram"), taskKpiReport.planograms],
            ].map(([title, groupRows]) => (
              <div key={title as string} className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                      <th className="px-3 py-2">{title as string}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.total")}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.open")}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.completed")}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.expired")}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.photos")}</th>
                      <th className="px-3 py-2 text-right">{t("taskKpi.columns.completion")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(groupRows as typeof taskKpiReport.stores).slice(0, 10).map((row) => (
                      <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.completed}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.expired}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.photoSubmissions}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.completionRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="font-semibold">{t("productTable.title")}</h2>
          <p className="mt-1 text-xs text-neutral-500">{t("productTable.hint")}</p>
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">{t("productTable.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                  <th className="px-3 py-2">{t("productTable.columns.planogram")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.product")}</th>
                  {visibleColumns.has("brand") ? (
                    <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  ) : null}
                  {visibleColumns.has("category") ? (
                    <th className="px-3 py-2">{t("productTable.columns.category")}</th>
                  ) : null}
                  {visibleColumns.has("supplier") ? (
                    <th className="px-3 py-2">{t("productTable.columns.supplier")}</th>
                  ) : null}
                  {visibleColumns.has("placements") ? (
                    <th className="px-3 py-2 text-right">{t("productTable.columns.placements")}</th>
                  ) : null}
                  {visibleColumns.has("units") ? (
                    <th className="px-3 py-2 text-right">{t("productTable.columns.units")}</th>
                  ) : null}
                  {visibleColumns.has("linearMeters") ? (
                    <th className="px-3 py-2 text-right">{t("productTable.columns.linearMeters")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/planograms/${row.planogramId}/${row.versionId}`}
                        className="font-medium hover:underline"
                      >
                        {row.planogramName}
                      </Link>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        v{row.versionNumber} · {t(`state.${row.state}` as never)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.productName}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{row.sku}</div>
                    </td>
                    {visibleColumns.has("brand") ? (
                      <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    ) : null}
                    {visibleColumns.has("category") ? (
                      <td className="px-3 py-2 text-neutral-600">{row.category ?? "—"}</td>
                    ) : null}
                    {visibleColumns.has("supplier") ? (
                      <td className="px-3 py-2 text-neutral-600">{row.supplier ?? "—"}</td>
                    ) : null}
                    {visibleColumns.has("placements") ? (
                      <td className="px-3 py-2 text-right tabular-nums">{row.placements}</td>
                    ) : null}
                    {visibleColumns.has("units") ? (
                      <td className="px-3 py-2 text-right tabular-nums">{row.units}</td>
                    ) : null}
                    {visibleColumns.has("linearMeters") ? (
                      <td className="px-3 py-2 text-right tabular-nums">{formatMeters(row.linearMm)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
