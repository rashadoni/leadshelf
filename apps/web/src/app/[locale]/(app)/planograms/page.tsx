import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"

function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString() : "—"
}

export default async function PlanogramsPage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("planograms"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const planograms = await tenantDb(session.org).planogram.findMany({
    include: {
      category: { select: { name: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          state: true,
          publishedAt: true,
          updatedAt: true,
          assignments: {
            select: {
              store: { select: { name: true, code: true } },
              format: { select: { name: true } },
            },
            take: 4,
          },
          tasks: { select: { status: true }, take: 50 },
          equipment: {
            select: {
              equipmentVersion: {
                select: {
                  template: { select: { name: true } },
                  shelves: { select: { id: true }, take: 12 },
                },
              },
            },
            take: 1,
          },
          _count: { select: { placements: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tNav("planograms")}</h1>
        <Link
          href="/planograms/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + {t("createNew")}
        </Link>
      </div>

      {planograms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2">{t("list.planogram")}</th>
                <th className="px-3 py-2">{t("list.preview")}</th>
                <th className="px-3 py-2">{t("list.status")}</th>
                <th className="px-3 py-2">{t("list.targets")}</th>
                <th className="px-3 py-2">{t("list.tasks")}</th>
                <th className="px-3 py-2">{t("list.updated")}</th>
                <th className="px-3 py-2 text-right">{t("list.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {planograms.map((p) => {
                const v = p.versions[0]
                const targetLabels = v?.assignments.map((assignment) => {
                  if (assignment.store) {
                    return assignment.store.code
                      ? `${assignment.store.name} (${assignment.store.code})`
                      : assignment.store.name
                  }
                  return assignment.format ? assignment.format.name : "—"
                }) ?? []
                const openTasks = v?.tasks.filter((task) => !["COMPLETED", "EXPIRED", "EMPTY"].includes(task.status)).length ?? 0
                const completedTasks = v?.tasks.filter((task) => task.status === "COMPLETED").length ?? 0
                const shelfCount = v?.equipment[0]?.equipmentVersion.shelves.length ?? 0
                return (
                  <tr key={p.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-3">
                      {v ? (
                        <Link
                          href={`/planograms/${p.id}/${v.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                      <div className="mt-1 text-xs text-neutral-500">{p.category?.name ?? t("list.noCategory")}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-16 w-36 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                        <div className="flex h-full flex-col justify-between gap-1">
                          {Array.from({ length: Math.max(1, Math.min(4, shelfCount)) }, (_, index) => (
                            <div key={index} className="relative h-2 rounded bg-neutral-300">
                              {index === 0 ? (
                                <span
                                  className="absolute left-0 top-0 h-2 rounded bg-neutral-900"
                                  style={{ width: `${Math.min(100, Math.max(18, (v?._count.placements ?? 0) * 11))}%` }}
                                />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {v?.equipment[0]?.equipmentVersion.template.name ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {v && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            v.state === "DRAFT"
                              ? "bg-amber-50 text-amber-700"
                              : v.state === "PUBLISHED"
                                ? "bg-green-50 text-green-700"
                                : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          v{v.versionNumber} · {t(`state.${v.state}` as never)}
                        </span>
                      )}
                      <div className="mt-1 text-xs text-neutral-500">
                        {v?._count.placements ?? 0} {t("placements")}
                      </div>
                    </td>
                    <td className="max-w-[250px] px-3 py-3 text-xs text-neutral-600">
                      {targetLabels.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {targetLabels.map((label) => (
                            <span key={label} className="rounded-full bg-neutral-100 px-2 py-0.5">
                              {label}
                            </span>
                          ))}
                          {(v?.assignments.length ?? 0) > targetLabels.length ? (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5">+{(v?.assignments.length ?? 0) - targetLabels.length}</span>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-600">
                      <div>{t("list.openTasks", { count: openTasks })}</div>
                      <div className="text-neutral-400">{t("list.completedTasks", { count: completedTasks })}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-500">
                      <div>{formatDate(v?.updatedAt)}</div>
                      {v?.publishedAt ? <div>{t("list.published", { date: formatDate(v.publishedAt) })}</div> : null}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {v ? (
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/planograms/${p.id}/${v.id}`}
                            className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
                          >
                            {t("list.open")}
                          </Link>
                          <Link
                            href={`/tasks?status=NEW`}
                            className="rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
                          >
                            {t("list.tasksAction")}
                          </Link>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
