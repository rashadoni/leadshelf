import { getTranslations } from "next-intl/server"
import { expireOverdueTasks, getTaskSlaSummary } from "@leadshelf/db"
import { getSession } from "@/server/auth/require-session"
import { tenantDb, workerDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { TaskStatusActions } from "./task-status-actions"
import { AssigneeSelect } from "./assignee-select"

const STATUSES = ["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED", "COMPLETED", "EXPIRED", "EMPTY"] as const

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const [t, tNav, session, params] = await Promise.all([
    getTranslations("tasks"),
    getTranslations("nav"),
    getSession(),
    searchParams,
  ])
  if (!session) return null

  const statusFilter = STATUSES.includes(params.status as never)
    ? (params.status as (typeof STATUSES)[number])
    : undefined

  const db = tenantDb(session.org)
  await expireOverdueTasks(workerDb, session.org)
  const [tasks, assignableUsers, sla] = await Promise.all([
    db.task.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      include: {
        store: { select: { name: true, code: true } },
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
          take: 1,
          select: { body: true, createdAt: true, user: { select: { name: true } } },
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
  ])

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{tNav("tasks")}</h1>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
          href="/tasks"
          className={`rounded-full px-3 py-1 text-sm ${!statusFilter ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"}`}
        >
          {t("all")}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/tasks?status=${s}`}
            className={`rounded-full px-3 py-1 text-sm ${statusFilter === s ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white text-neutral-600"}`}
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
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
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
                <tr key={task.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2 font-medium">{task.title}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {task.store.name} {task.store.code && `(${task.store.code})`}
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
                  <td className="px-3 py-2 text-neutral-500">
                    {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}
                  </td>
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
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        task.status === "COMPLETED"
                          ? "bg-green-50 text-green-700"
                          : task.status === "EXPIRED"
                            ? "bg-red-50 text-red-600"
                            : task.status === "NEW"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {t(`status.${task.status}` as never)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <TaskStatusActions taskId={task.id} status={task.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
