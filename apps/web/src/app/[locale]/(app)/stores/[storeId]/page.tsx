import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—"
}

function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString() : "—"
}

function formatDateTime(value: Date | null | undefined): string {
  return value ? value.toLocaleString() : "—"
}

function score(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`
}

function statusClass(status: string): string {
  if (status === "COMPLETED" || status === "APPROVED") return "bg-emerald-50 text-emerald-700"
  if (status === "EXPIRED" || status === "REJECTED") return "bg-red-50 text-red-700"
  if (status === "NEW" || status === "PLANNED") return "bg-blue-50 text-blue-700"
  return "bg-amber-50 text-amber-700"
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>
}) {
  const [{ storeId }, t, tTasks, tReviews, tField, tPlanograms, session] = await Promise.all([
    params,
    getTranslations("stores"),
    getTranslations("tasks"),
    getTranslations("reviews"),
    getTranslations("fieldForce"),
    getTranslations("planograms"),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const store = await db.store.findFirst({
    where: { id: storeId },
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      latitude: true,
      longitude: true,
      isActive: true,
      format: { select: { name: true } },
      region: { select: { name: true } },
      floorPlans: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: {
              versionNumber: true,
              widthMm: true,
              depthMm: true,
              isPublished: true,
              publishedAt: true,
              equipment: {
                orderBy: [{ xMm: "asc" }, { yMm: "asc" }],
                select: {
                  id: true,
                  label: true,
                  xMm: true,
                  yMm: true,
                  rotationDeg: true,
                  planogram: { select: { id: true, name: true } },
                  equipmentVersion: { select: { template: { select: { name: true } } } },
                },
              },
            },
          },
        },
      },
      planogramAssignments: {
        orderBy: { activeFrom: "desc" },
        select: {
          id: true,
          activeFrom: true,
          activeTo: true,
          planogramVersion: {
            select: {
              id: true,
              versionNumber: true,
              state: true,
              publishedAt: true,
              planogram: { select: { id: true, name: true } },
              _count: { select: { placements: true, equipment: true, tasks: true } },
            },
          },
        },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          assignee: { select: { name: true, employeeCode: true } },
          planogramVersion: {
            select: {
              id: true,
              versionNumber: true,
              planogram: { select: { id: true, name: true } },
            },
          },
          _count: { select: { comments: true, photoSubmissions: true, humanReviews: true } },
        },
      },
      routeStops: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          sortOrder: true,
          plannedAt: true,
          route: {
            select: {
              id: true,
              name: true,
              isActive: true,
              agent: { select: { user: { select: { name: true } }, employeeCode: true } },
            },
          },
          visits: {
            orderBy: { createdAt: "desc" },
            take: 2,
            select: { id: true, status: true, checkInAt: true, checkOutAt: true, anomalyFlags: true },
          },
        },
      },
      visits: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          anomalyFlags: true,
          agent: { select: { user: { select: { name: true } }, employeeCode: true } },
          photoSubmissions: { select: { id: true } },
        },
      },
      photoSubmissions: {
        orderBy: { takenAt: "desc" },
        take: 8,
        select: {
          id: true,
          url: true,
          takenAt: true,
          qualityScore: true,
          task: { select: { id: true, title: true } },
          user: { select: { name: true } },
          humanReviews: {
            orderBy: { updatedAt: "desc" },
            select: { id: true, reason: true, status: true, score: true, note: true },
          },
        },
      },
      _count: {
        select: {
          floorPlans: true,
          planogramAssignments: true,
          tasks: true,
          routeStops: true,
          visits: true,
          photoSubmissions: true,
        },
      },
    },
  })

  if (!store) notFound()

  const openTasks = store.tasks.filter((task) => !["COMPLETED", "EXPIRED", "EMPTY"].includes(task.status)).length
  const pendingReviews = store.photoSubmissions.reduce(
    (sum, photo) => sum + photo.humanReviews.filter((review) => review.status === "PENDING").length,
    0,
  )
  const activeAssignments = store.planogramAssignments.filter((item) => !item.activeTo).length
  const latestFloorPlan = store.floorPlans[0]
  const latestFloorPlanVersion = latestFloorPlan?.versions[0]

  const qualitySignals = [
    {
      label: t("detail.quality.floorPlan"),
      ok: Boolean(latestFloorPlanVersion),
      value: latestFloorPlanVersion
        ? `${latestFloorPlan?.name} · v${latestFloorPlanVersion.versionNumber}`
        : t("detail.quality.missing"),
    },
    {
      label: t("detail.quality.assignment"),
      ok: activeAssignments > 0,
      value: activeAssignments,
    },
    {
      label: t("detail.quality.openTasks"),
      ok: openTasks === 0,
      value: openTasks,
    },
    {
      label: t("detail.quality.pendingReviews"),
      ok: pendingReviews === 0,
      value: pendingReviews,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stores" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← {t("detail.backToStores")}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{store.name}</h1>
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                store.isActive ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {store.isActive ? t("active") : t("inactive")}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            {[store.code, store.address, store.format?.name, store.region?.name].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <div>{store.latitude != null && store.longitude != null ? `${store.latitude}, ${store.longitude}` : t("detail.noGeo")}</div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label={t("table.floorPlans")} value={store._count.floorPlans} />
        <Metric label={t("table.assignments")} value={activeAssignments} />
        <Metric label={t("table.tasks")} value={store._count.tasks} />
        <Metric label={t("table.routes")} value={store._count.routeStops} />
        <Metric label={t("detail.visits")} value={store._count.visits} />
        <Metric label={t("detail.photoProof")} value={store._count.photoSubmissions} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel title={t("detail.floorPlans")}>
            {!latestFloorPlanVersion ? (
              <div className="text-sm text-neutral-500">{t("detail.noFloorPlan")}</div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link href="/floor-plans" className="font-medium hover:underline">
                      {latestFloorPlan?.name} · v{latestFloorPlanVersion.versionNumber}
                    </Link>
                    <div className="mt-1 text-xs text-neutral-500">
                      {latestFloorPlanVersion.widthMm}x{latestFloorPlanVersion.depthMm} mm ·{" "}
                      {latestFloorPlanVersion.isPublished ? t("detail.published") : t("detail.draft")} ·{" "}
                      {formatDate(latestFloorPlanVersion.publishedAt)}
                    </div>
                  </div>
                  <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
                    {t("detail.equipmentCount", { count: latestFloorPlanVersion.equipment.length })}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {latestFloorPlanVersion.equipment.map((item) => (
                    <div key={item.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
                      <div className="font-medium">{item.label || item.equipmentVersion.template.name}</div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {item.equipmentVersion.template.name} · {item.xMm}x{item.yMm} mm · {item.rotationDeg}°
                      </div>
                      {item.planogram ? (
                        <div className="mt-2 text-xs text-neutral-600">{item.planogram.name}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title={t("detail.assignments")}>
            {store.planogramAssignments.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {store.planogramAssignments.map((assignment) => (
                  <div key={assignment.id} className="grid gap-2 py-3 md:grid-cols-[1fr_180px]">
                    <div>
                      <Link
                        href={`/planograms/${assignment.planogramVersion.planogram.id}/${assignment.planogramVersion.id}`}
                        className="font-medium hover:underline"
                      >
                        {assignment.planogramVersion.planogram.name} · v{assignment.planogramVersion.versionNumber}
                      </Link>
                      <div className="mt-1 text-xs text-neutral-500">
                        {tPlanograms(`state.${assignment.planogramVersion.state}` as never)} · {formatDate(assignment.planogramVersion.publishedAt)}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Metric label={t("detail.metrics.placements")} value={assignment.planogramVersion._count.placements} />
                      <Metric label={t("detail.metrics.equipment")} value={assignment.planogramVersion._count.equipment} />
                      <Metric label={t("detail.metrics.tasks")} value={assignment.planogramVersion._count.tasks} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("detail.tasks")}>
            {store.tasks.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] text-sm">
                  <thead className="text-left text-xs uppercase text-neutral-500">
                    <tr>
                      <th className="py-2 pr-3">{tTasks("table.title")}</th>
                      <th className="py-2 pr-3">{tTasks("table.status")}</th>
                      <th className="py-2 pr-3">{tTasks("table.assignee")}</th>
                      <th className="py-2 pr-3">{tTasks("table.due")}</th>
                      <th className="py-2 pr-3">{t("detail.photoProof")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {store.tasks.map((task) => (
                      <tr key={task.id}>
                        <td className="py-2 pr-3">
                          <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
                            {task.title}
                          </Link>
                          {task.planogramVersion ? (
                            <div className="text-xs text-neutral-500">
                              {task.planogramVersion.planogram.name} · v{task.planogramVersion.versionNumber}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(task.status)}`}>
                            {tTasks(`status.${task.status}` as never)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-neutral-600">{task.assignee?.name ?? tTasks("unassigned")}</td>
                        <td className="py-2 pr-3 text-neutral-600">{formatDate(task.dueAt)}</td>
                        <td className="py-2 pr-3 text-neutral-600">
                          {task._count.photoSubmissions} / {task._count.humanReviews}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title={t("detail.photoProof")}>
            {store.photoSubmissions.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {store.photoSubmissions.map((photo) => (
                  <div key={photo.id} className="rounded-lg border border-neutral-200 p-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{photo.task?.title ?? tReviews("untitled")}</span>
                        <span className="text-xs text-neutral-500">{score(photo.qualityScore)}</span>
                      </div>
                      <div className="text-xs text-neutral-500">
                        {photo.user.name} · {formatDateTime(photo.takenAt)}
                      </div>
                      <a
                        href={`/api/media/${photo.url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                      >
                        {t("detail.openPhoto")}
                      </a>
                      <div className="flex flex-wrap gap-1">
                        {photo.humanReviews.length === 0 ? (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                            {tField("officeSnapshot.noReview")}
                          </span>
                        ) : (
                          photo.humanReviews.map((review) => (
                            <span key={review.id} className={`rounded px-1.5 py-0.5 text-xs ${statusClass(review.status)}`}>
                              {tReviews(`reason.${review.reason}` as never)} · {tReviews(`status.${review.status}` as never)}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title={t("detail.dataQuality")}>
            <div className="space-y-2">
              {qualitySignals.map((signal) => (
                <div key={signal.label} className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                  <span className="text-neutral-600">{signal.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${signal.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {signal.value}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={t("detail.fieldWork")}>
            {store.routeStops.length === 0 && store.visits.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="space-y-3 text-sm">
                {store.routeStops.map((stop) => (
                  <div key={stop.id} className="rounded-lg bg-neutral-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{stop.route.name}</div>
                      <span className="text-xs text-neutral-500">#{stop.sortOrder}</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {stop.route.agent?.user.name ?? tField("unassigned")} · {formatDate(stop.plannedAt)}
                    </div>
                    {stop.visits.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {stop.visits.map((visit) => (
                          <div key={visit.id} className="text-xs text-neutral-600">
                            {tField(`visitStatus.${visit.status}` as never)} · {formatDateTime(visit.checkInAt ?? visit.checkOutAt)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {store.visits.slice(0, 5).map((visit) => (
                  <div key={visit.id} className="rounded-lg bg-neutral-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(visit.status)}`}>
                        {tField(`visitStatus.${visit.status}` as never)}
                      </span>
                      <span className="text-xs text-neutral-500">{visit.photoSubmissions.length} фото</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {visit.agent.user.name} · {formatDateTime(visit.checkInAt ?? visit.checkOutAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}
