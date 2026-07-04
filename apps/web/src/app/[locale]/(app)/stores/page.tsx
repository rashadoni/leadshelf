import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—"
}

export default async function StoresPage() {
  const [t, session] = await Promise.all([getTranslations("stores"), getSession()])
  if (!session) return null

  const db = tenantDb(session.org)
  const [stores, formats] = await Promise.all([
    db.store.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        isActive: true,
        format: { select: { name: true } },
        region: { select: { name: true } },
        _count: {
          select: {
            floorPlans: true,
            planogramAssignments: true,
            tasks: true,
            routeStops: true,
            visits: true,
          },
        },
      },
      take: 500,
    }),
    db.storeFormat.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        _count: {
          select: {
            stores: true,
            floorPlans: true,
            planogramAssignments: true,
            assortmentMatrix: true,
          },
        },
      },
      take: 200,
    }),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">{t("subtitle")}</p>
      </div>

      <section className="mb-6 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-500">{t("cards.stores")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stores.length}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-500">{t("cards.activeStores")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {stores.filter((store) => store.isActive).length}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-500">{t("cards.formats")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formats.length}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-500">{t("cards.assignments")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {stores.reduce((sum, store) => sum + store._count.planogramAssignments, 0)}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold">{t("storesTitle")}</h2>
        </div>
        {stores.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">{t("emptyStores")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">{t("table.store")}</th>
                  <th className="px-3 py-2">{t("table.format")}</th>
                  <th className="px-3 py-2">{t("table.region")}</th>
                  <th className="px-3 py-2">{t("table.floorPlans")}</th>
                  <th className="px-3 py-2">{t("table.assignments")}</th>
                  <th className="px-3 py-2">{t("table.tasks")}</th>
                  <th className="px-3 py-2">{t("table.routes")}</th>
                  <th className="px-3 py-2">{t("table.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className="px-3 py-3">
                      <div className="font-medium">{store.name}</div>
                      <div className="text-xs text-neutral-500">
                        {dash(store.code)}
                        {store.address ? ` · ${store.address}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3">{dash(store.format?.name)}</td>
                    <td className="px-3 py-3">{dash(store.region?.name)}</td>
                    <td className="px-3 py-3 tabular-nums">{store._count.floorPlans}</td>
                    <td className="px-3 py-3 tabular-nums">{store._count.planogramAssignments}</td>
                    <td className="px-3 py-3 tabular-nums">{store._count.tasks}</td>
                    <td className="px-3 py-3 text-xs text-neutral-600">
                      {t("routeVisitCount", {
                        routes: store._count.routeStops,
                        visits: store._count.visits,
                      })}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          store.isActive ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {store.isActive ? t("active") : t("inactive")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold">{t("formatsTitle")}</h2>
        </div>
        {formats.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">{t("emptyFormats")}</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {formats.map((format) => (
              <div key={format.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_repeat(4,120px)]">
                <div>
                  <div className="font-medium">{format.name}</div>
                  <div className="text-xs text-neutral-500">{dash(format.description)}</div>
                </div>
                <Metric label={t("formatMetrics.stores")} value={format._count.stores} />
                <Metric label={t("formatMetrics.floorPlans")} value={format._count.floorPlans} />
                <Metric label={t("formatMetrics.assignments")} value={format._count.planogramAssignments} />
                <Metric label={t("formatMetrics.assortment")} value={format._count.assortmentMatrix} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  )
}
