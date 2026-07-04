import { getTranslations } from "next-intl/server"
import { Fragment } from "react"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—"
}

function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString() : "—"
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
        floorPlans: {
          orderBy: { updatedAt: "desc" },
          take: 2,
          select: {
            id: true,
            name: true,
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: {
                versionNumber: true,
                isPublished: true,
                publishedAt: true,
                _count: { select: { equipment: true } },
              },
            },
          },
        },
        planogramAssignments: {
          orderBy: { activeFrom: "desc" },
          take: 4,
          select: {
            activeFrom: true,
            activeTo: true,
            planogramVersion: {
              select: {
                id: true,
                versionNumber: true,
                state: true,
                planogram: { select: { id: true, name: true } },
              },
            },
          },
        },
        tasks: {
          orderBy: { updatedAt: "desc" },
          take: 4,
          select: {
            title: true,
            status: true,
            dueAt: true,
            planogramVersion: {
              select: {
                id: true,
                versionNumber: true,
                planogram: { select: { id: true, name: true } },
              },
            },
            _count: { select: { photoSubmissions: true } },
          },
        },
        routeStops: {
          orderBy: { sortOrder: "asc" },
          take: 3,
          select: { sortOrder: true, plannedAt: true, route: { select: { name: true, isActive: true } } },
        },
        visits: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { status: true, checkInAt: true, checkOutAt: true },
        },
        photoSubmissions: {
          orderBy: { takenAt: "desc" },
          take: 3,
          select: { url: true, takenAt: true, qualityScore: true },
        },
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
            <table className="min-w-[980px] text-sm">
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
                  <Fragment key={store.id}>
                    <tr>
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
                    <tr className="bg-neutral-50/60">
                      <td colSpan={8} className="px-3 py-3">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-neutral-700 hover:text-neutral-950">
                            {t("detail.open")}
                          </summary>
                          <div className="mt-3 grid gap-3 lg:grid-cols-5">
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                              <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.floorPlans")}</div>
                              <div className="space-y-1 text-xs text-neutral-600">
                                {store.floorPlans.length > 0 ? (
                                  store.floorPlans.map((plan) => {
                                    const version = plan.versions[0]
                                    return (
                                      <div key={plan.id}>
                                        <Link href="/floor-plans" className="font-medium hover:underline">
                                          {plan.name}
                                        </Link>
                                        <div className="text-neutral-400">
                                          v{version?.versionNumber ?? "—"} · {version?.isPublished ? t("detail.published") : t("detail.draft")} ·{" "}
                                          {t("detail.equipmentCount", { count: version?._count.equipment ?? 0 })}
                                        </div>
                                      </div>
                                    )
                                  })
                                ) : (
                                  <div>—</div>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                              <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.assignments")}</div>
                              <div className="space-y-1 text-xs text-neutral-600">
                                {store.planogramAssignments.length > 0 ? (
                                  store.planogramAssignments.map((assignment) => (
                                    <div key={`${assignment.planogramVersion.id}-${assignment.activeFrom.toISOString()}`}>
                                      <Link
                                        href={`/planograms/${assignment.planogramVersion.planogram.id}/${assignment.planogramVersion.id}`}
                                        className="font-medium hover:underline"
                                      >
                                        {assignment.planogramVersion.planogram.name} · v{assignment.planogramVersion.versionNumber}
                                      </Link>
                                      <div className="text-neutral-400">{formatDate(assignment.activeFrom)}</div>
                                    </div>
                                  ))
                                ) : (
                                  <div>—</div>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                              <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.tasks")}</div>
                              <div className="space-y-1 text-xs text-neutral-600">
                                {store.tasks.length > 0 ? (
                                  store.tasks.map((task) => (
                                    <div key={`${task.title}-${task.dueAt?.toISOString() ?? "no-due"}`}>
                                      <Link href={`/tasks?status=${task.status}`} className="font-medium hover:underline">
                                        {task.title}
                                      </Link>
                                      <div className="text-neutral-400">
                                        {task.status} · {formatDate(task.dueAt)} · {t("detail.photos", { count: task._count.photoSubmissions })}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div>—</div>
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                              <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.fieldWork")}</div>
                              <div className="space-y-1 text-xs text-neutral-600">
                                {store.routeStops.map((stop) => (
                                  <div key={`${stop.route.name}-${stop.sortOrder}`}>
                                    {stop.route.name} · #{stop.sortOrder}
                                    <div className="text-neutral-400">{formatDate(stop.plannedAt)}</div>
                                  </div>
                                ))}
                                {store.visits.map((visit) => (
                                  <div key={`${visit.status}-${visit.checkInAt?.toISOString() ?? "planned"}`}>
                                    {visit.status}
                                    <div className="text-neutral-400">{formatDate(visit.checkInAt ?? visit.checkOutAt)}</div>
                                  </div>
                                ))}
                                {store.routeStops.length === 0 && store.visits.length === 0 ? <div>—</div> : null}
                              </div>
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-white p-3">
                              <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.photoProof")}</div>
                              <div className="space-y-1 text-xs text-neutral-600">
                                {store.photoSubmissions.length > 0 ? (
                                  store.photoSubmissions.map((photo) => (
                                    <div key={photo.url}>
                                      <a href={`/api/media/${photo.url}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                                        {formatDate(photo.takenAt)}
                                      </a>
                                      {photo.qualityScore == null ? null : (
                                        <span className="text-neutral-400"> · {(photo.qualityScore * 100).toFixed(0)}%</span>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <div>—</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  </Fragment>
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
