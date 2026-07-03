import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"

type ProductRow = {
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

function formatMeters(mm: number): string {
  return (mm / 1000).toFixed(2)
}

export default async function AnalyticsPage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("analytics"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const placements = await tenantDb(session.org).planogramPlacement.findMany({
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

  const rows = [...rowsByKey.values()].sort((a, b) => {
    const planogram = a.planogramName.localeCompare(b.planogramName)
    if (planogram !== 0) return planogram
    return a.sku.localeCompare(b.sku)
  })
  const uniquePlanograms = new Set(rows.map((r) => r.versionId)).size
  const uniqueProducts = new Set(rows.map((r) => r.sku)).size
  const totalUnits = rows.reduce((sum, r) => sum + r.units, 0)
  const totalLinearMm = rows.reduce((sum, r) => sum + r.linearMm, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{tNav("analytics")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">{t("subtitle")}</p>
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
                  <th className="px-3 py-2">{t("productTable.columns.brand")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.category")}</th>
                  <th className="px-3 py-2">{t("productTable.columns.supplier")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.placements")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.units")}</th>
                  <th className="px-3 py-2 text-right">{t("productTable.columns.linearMeters")}</th>
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
                    <td className="px-3 py-2 text-neutral-600">{row.brand ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.category ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{row.supplier ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.placements}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.units}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMeters(row.linearMm)}</td>
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
