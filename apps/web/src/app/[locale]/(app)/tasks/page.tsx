import { getLocale, getTranslations } from "next-intl/server"
import { Fragment } from "react"
import { expireOverdueTasks, getTaskSlaSummary } from "@leadshelf/db"
import { getSession } from "@/server/auth/require-session"
import { tenantDb, workerDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { TaskStatusActions } from "./task-status-actions"
import { AssigneeSelect } from "./assignee-select"
import { formatLocaleDate } from "@/i18n/format"

const STATUSES = ["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED", "COMPLETED", "EXPIRED", "EMPTY"] as const

function taskStatusClass(status: string): string {
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-700"
  if (status === "EXPIRED") return "bg-red-50 text-red-700"
  if (status === "NEW") return "bg-blue-50 text-blue-700"
  return "bg-amber-50 text-amber-700"
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const [t, tNav, session, params, locale] = await Promise.all([
    getTranslations("tasks"),
    getTranslations("nav"),
    getSession(),
    searchParams,
    getLocale(),
  ])
  if (!session) return null

  const statusFilter = STATUSES.includes(params.status as never)
    ? (params.status as (typeof STATUSES)[number])
    : undefined
  const storeFilterId = params.storeId?.trim() || undefined

  const db = tenantDb(session.org)
  await expireOverdueTasks(workerDb, session.org)
  const [tasks, assignableUsers, sla, filterStore] = await Promise.all([
    db.task.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(storeFilterId ? { storeId: storeFilterId } : {}),
      },
      include: {
        store: { select: { id: true, name: true, code: true } },
        assignee: { select: { id: true, name: true } },
        planogramVersion: {
          select: {
            id: true,
            versionNumber: true,
            planogram: { select: { id: true, name: true } },
          },
        },
        comments: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { body: true, createdAt: true, user: { select: { name: true } } },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { fromStatus: true, toStatus: true, createdAt: true },
        },
        photoSubmissions: {
          orderBy: { takenAt: "desc" },
          take: 3,
          select: {
            url: true,
            mediaType: true,
            durationMs: true,
            takenAt: true,
            qualityScore: true,
            user: { select: { name: true } },
          },
        },
        humanReviews: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { reason: true, status: true, score: true, note: true, createdAt: true },
        },
        _count: { select: { comments: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ["MERCHANDISER", "SUPERVISOR", "STORE_STAFF"] } },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { name: "asc" },
    }),
    getTaskSlaSummary(workerDb, session.org),
    storeFilterId
      ? db.store.findFirst({ where: { id: storeFilterId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ])

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{tNav("tasks")}</h1>

      {filterStore ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          <span>{t("filteredStore", { store: filterStore.name })}</span>
          <Link href="/tasks" className="font-medium text-indigo-700 hover:underline">
            {t("clearStoreFilter")}
          </Link>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          ["sla.open", sla.open],
          ["sla.dueToday", sla.dueToday],
          ["sla.expired", sla.expired],
          ["sla.completed", sla.completed],
          ["sla.unassignedOpen", sla.unassignedOpen],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{t(label as never)}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        <Link
          href={storeFilterId ? `/tasks?storeId=${encodeURIComponent(storeFilterId)}` : "/tasks"}
          className={`rounded-full px-3 py-1 text-sm ${!statusFilter ? "bg-indigo-600 text-white" : "bg-white text-neutral-600 border border-neutral-200"}`}
        >
          {t("all")}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/tasks?status=${s}${storeFilterId ? `&storeId=${encodeURIComponent(storeFilterId)}` : ""}`}
            className={`rounded-full px-3 py-1 text-sm ${statusFilter === s ? "bg-indigo-600 text-white" : "border border-neutral-200 bg-white text-neutral-600"}`}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {tasks.map((task) => (
              <article key={task.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/tasks/${task.id}`}
                      className="font-semibold text-neutral-950 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    >
                      {task.title}
                    </Link>
                    <Link
                      href={`/stores/${task.store.id}`}
                      className="mt-1 block truncate text-xs text-neutral-500 hover:text-indigo-700 hover:underline"
                    >
                      {task.store.name}{task.store.code ? ` (${task.store.code})` : ""}
                    </Link>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${taskStatusClass(task.status)}`}>
                    {t(`status.${task.status}` as never)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3">
                  <div>
                    <div className="text-[11px] font-medium text-neutral-500">{t("table.due")}</div>
                    <div className="mt-1 text-sm text-neutral-800">{formatLocaleDate(task.dueAt, locale)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-neutral-500">{t("table.assignee")}</div>
                    <div className="mt-1">
                      <AssigneeSelect
                        taskId={task.id}
                        current={task.assignee?.id ?? null}
                        users={assignableUsers}
                      />
                    </div>
                  </div>
                </div>

                {task.comments[0] ? (
                  <div className="mt-3 rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">
                    <div className="line-clamp-2 text-neutral-800">{task.comments[0].body}</div>
                    <div className="mt-1 text-neutral-500">
                      {task.comments[0].user.name}
                      {task._count.comments > 1 ? ` · +${task._count.comments - 1}` : ""}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/tasks/${task.id}`} className="text-xs font-medium text-indigo-700 hover:underline">
                    {t("detail.openPage")}
                  </Link>
                  {task.status === "PHOTO_SUBMITTED" ? (
                    <Link
                      href={`/tasks/${task.id}`}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    >
                      {t("reviewTask")}
                    </Link>
                  ) : (
                    <TaskStatusActions taskId={task.id} status={task.status} />
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white lg:block">
          <table className="min-w-[1120px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2">{t("table.title")}</th>
                <th className="px-3 py-2">{t("table.store")}</th>
                <th className="px-3 py-2">{t("table.planogram")}</th>
                <th className="px-3 py-2">{t("table.due")}</th>
                <th className="px-3 py-2">{t("table.assignee")}</th>
                <th className="px-3 py-2">{t("table.feedback")}</th>
                <th className="px-3 py-2">{t("table.status")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <Fragment key={task.id}>
                  <tr className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      <Link href={`/stores/${task.store.id}`} className="hover:underline">
                        {task.store.name} {task.store.code && `(${task.store.code})`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {task.planogramVersion && (
                        <Link
                          href={`/planograms/${task.planogramVersion.planogram.id}/${task.planogramVersion.id}`}
                          className="text-neutral-600 hover:underline"
                        >
                          {task.planogramVersion.planogram.name} · v{task.planogramVersion.versionNumber}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{formatLocaleDate(task.dueAt, locale)}</td>
                    <td className="px-3 py-2">
                      <AssigneeSelect
                        taskId={task.id}
                        current={task.assignee?.id ?? null}
                        users={assignableUsers}
                      />
                    </td>
                    <td className="max-w-[240px] px-3 py-2 text-xs text-neutral-500">
                      {task.comments[0] ? (
                        <div>
                          <div className="truncate text-neutral-700">{task.comments[0].body}</div>
                          <div>
                            {task.comments[0].user.name}
                            {task._count.comments > 1 ? ` · +${task._count.comments - 1}` : ""}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${taskStatusClass(task.status)}`}
                      >
                        {t(`status.${task.status}` as never)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {task.status === "PHOTO_SUBMITTED" ? (
                        <Link
                          href={`/tasks/${task.id}`}
                          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                        >
                          {t("reviewTask")}
                        </Link>
                      ) : (
                        <TaskStatusActions taskId={task.id} status={task.status} />
                      )}
                    </td>
                  </tr>
                  <tr className="border-b border-neutral-100 last:border-0 bg-neutral-50/60">
                    <td colSpan={8} className="px-3 py-3">
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-medium text-neutral-700 hover:text-neutral-950">
                          {t("detail.open")}
                        </summary>
                        <div className="mt-3 grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-neutral-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.history")}</div>
                            <div className="space-y-1 text-xs text-neutral-600">
                              {task.statusHistory.length > 0 ? (
                                task.statusHistory.map((item) => (
                                  <div key={`${item.toStatus}-${item.createdAt.toISOString()}`}>
                                    {item.fromStatus ? t(`status.${item.fromStatus}` as never) : "—"} →{" "}
                                    {t(`status.${item.toStatus}` as never)}
                                    <span className="text-neutral-400"> · {formatLocaleDate(item.createdAt, locale)}</span>
                                  </div>
                                ))
                              ) : (
                                <div>—</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-lg border border-neutral-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.photos")}</div>
                            <div className="space-y-1 text-xs text-neutral-600">
                              {task.photoSubmissions.length > 0 ? (
                                task.photoSubmissions.map((photo) => (
                                  <div key={photo.url}>
                                    <a href={`/api/media/${photo.url}`} className="font-medium hover:underline" target="_blank" rel="noreferrer">
                                      {photo.mediaType === "VIDEO" ? t("detail.videoProof") : formatLocaleDate(photo.takenAt, locale)}
                                    </a>
                                    <span className="text-neutral-400"> · {photo.user.name}</span>
                                    {photo.durationMs == null ? null : (
                                      <span className="text-neutral-400"> · {Math.round(photo.durationMs / 1000)}s</span>
                                    )}
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
                          <div className="rounded-lg border border-neutral-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.reviews")}</div>
                            <div className="space-y-1 text-xs text-neutral-600">
                              {task.humanReviews.length > 0 ? (
                                task.humanReviews.map((review) => (
                                  <div key={`${review.status}-${review.createdAt.toISOString()}`}>
                                    {review.reason} · {review.status}
                                    {review.score == null ? null : (
                                      <span className="text-neutral-400"> · {(review.score * 100).toFixed(0)}%</span>
                                    )}
                                    {review.note ? <div className="text-neutral-500">{review.note}</div> : null}
                                  </div>
                                ))
                              ) : (
                                <div>—</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-lg border border-neutral-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-neutral-500">{t("detail.comments")}</div>
                            <div className="space-y-1 text-xs text-neutral-600">
                              {task.comments.length > 0 ? (
                                task.comments.map((comment) => (
                                  <div key={`${comment.user.name}-${comment.createdAt.toISOString()}`}>
                                    <div className="text-neutral-700">{comment.body}</div>
                                    <div className="text-neutral-400">
                                      {comment.user.name} · {formatLocaleDate(comment.createdAt, locale)}
                                    </div>
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
        </>
      )}
    </div>
  )
}
