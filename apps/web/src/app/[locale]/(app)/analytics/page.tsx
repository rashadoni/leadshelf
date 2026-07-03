import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import {
  formatMeters,
  getAbcRows,
  getPlanogramProductRows,
  type AbcClass,
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

function abcBadgeClass(value: AbcClass): string {
  if (value === "A") return "bg-green-50 text-green-700"
  if (value === "B") return "bg-amber-50 text-amber-700"
  return "bg-neutral-100 text-neutral-600"
}

function parseGroup(raw: string | undefined): GroupColumn | null {
  return GROUP_COLUMNS.includes(raw as GroupColumn) ? (raw as GroupColumn) : null
}

function analyticsHref(visibleColumns: Set<OptionalColumn>, groupBy: GroupColumn | null): string {
  const params = new URLSearchParams()
  const cols = OPTIONAL_COLUMNS.filter((c) => visibleColumns.has(c))
  if (cols.length !== OPTIONAL_COLUMNS.length) params.set("cols", cols.join(","))
  if (groupBy) params.set("group", groupBy)
  const query = params.toString()
  return query ? `/analytics?${query}` : "/analytics"
}

function columnHref(
  column: OptionalColumn,
  visibleColumns: Set<OptionalColumn>,
  groupBy: GroupColumn | null,
): string {
  const next = new Set(visibleColumns)
  if (next.has(column)) {
    next.delete(column)
  } else {
    next.add(column)
  }
  return analyticsHref(next, groupBy)
}

function groupHref(groupBy: GroupColumn | null, visibleColumns: Set<OptionalColumn>): string {
  return analyticsHref(visibleColumns, groupBy)
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

  const db = tenantDb(session.org)
  const [rows, abcRows] = await Promise.all([getPlanogramProductRows(db), getAbcRows(db)])
  const uniquePlanograms = new Set(rows.map((r) => r.versionId)).size
  const uniqueProducts = new Set(rows.map((r) => r.sku)).size
  const totalUnits = rows.reduce((sum, r) => sum + r.units, 0)
  const totalLinearMm = rows.reduce((sum, r) => sum + r.linearMm, 0)
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

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("kpi.planograms"), uniquePlanograms],
          [t("kpi.products"), uniqueProducts],
          [t("kpi.units"), totalUnits],
          [t("kpi.linearMeters"), formatMeters(totalLinearMm)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

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
                href={columnHref(column, visibleColumns, groupBy)}
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
            href={groupHref(null, visibleColumns)}
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
              href={groupHref(column, visibleColumns)}
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
