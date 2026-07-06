import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { AssigneeSelect } from "../assignee-select"
import { TaskStatusActions } from "../task-status-actions"

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
  if (status === "NEW") return "bg-blue-50 text-blue-700"
  return "bg-amber-50 text-amber-700"
}

function ProofMedia({
  url,
  mediaType,
  className,
}: {
  url: string
  mediaType?: "PHOTO" | "VIDEO" | null
  className: string
}) {
  const src = `/api/media/${url}`
  if (mediaType === "VIDEO") {
    return (
      <video className={className} controls muted playsInline preload="metadata">
        <source src={src} />
      </video>
    )
  }
  return <img src={src} alt="" className={className} />
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const [{ taskId }, t, tStores, tReviews, tPlanograms, session] = await Promise.all([
    params,
    getTranslations("tasks"),
    getTranslations("stores"),
    getTranslations("reviews"),
    getTranslations("planograms"),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const [task, assignableUsers] = await Promise.all([
    db.task.findFirst({
      where: { id: taskId },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            format: { select: { name: true } },
            region: { select: { name: true } },
          },
        },
        assignee: { select: { id: true, name: true, employeeCode: true } },
        planogramVersion: {
          select: {
            id: true,
            versionNumber: true,
            state: true,
            publishedAt: true,
            planogram: { select: { id: true, name: true } },
            _count: { select: { placements: true, equipment: true, assignments: true, tasks: true } },
          },
        },
        comments: {
          orderBy: { createdAt: "desc" },
          select: { body: true, createdAt: true, user: { select: { name: true } } },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          select: { fromStatus: true, toStatus: true, createdAt: true },
        },
        photoSubmissions: {
          orderBy: { takenAt: "desc" },
          select: {
            id: true,
            url: true,
            mediaType: true,
            durationMs: true,
            takenAt: true,
            qualityScore: true,
            user: { select: { name: true } },
            humanReviews: {
              orderBy: { updatedAt: "desc" },
              select: { id: true, reason: true, status: true, score: true, note: true, reviewedAt: true },
            },
          },
        },
        humanReviews: {
          orderBy: { updatedAt: "desc" },
          select: { id: true, reason: true, status: true, score: true, note: true, reviewedAt: true, updatedAt: true },
        },
      },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ["MERCHANDISER", "SUPERVISOR", "STORE_STAFF", "FIELD_AGENT"] } },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { name: "asc" },
    }),
  ])

  if (!task) notFound()

  const pendingReviews = task.humanReviews.filter((review) => review.status === "PENDING").length
  const latestPhoto = task.photoSubmissions[0]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/tasks" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← {t("detail.backToTasks")}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{task.title}</h1>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(task.status)}`}>
              {t(`status.${task.status}` as never)}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            {task.description || t("detail.noDescription")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AssigneeSelect taskId={task.id} current={task.assigneeId} users={assignableUsers} />
          <TaskStatusActions taskId={task.id} status={task.status} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label={t("detail.metrics.due")} value={formatDate(task.dueAt)} />
        <Metric label={t("detail.metrics.assignee")} value={task.assignee?.name ?? t("unassigned")} />
        <Metric label={t("detail.metrics.photos")} value={task.photoSubmissions.length} />
        <Metric label={t("detail.metrics.pendingReviews")} value={pendingReviews} />
        <Metric label={t("detail.metrics.latestPhoto")} value={latestPhoto ? formatDate(latestPhoto.takenAt) : "—"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel title={t("detail.media")}>
            {task.photoSubmissions.length === 0 ? (
              <div className="text-sm text-neutral-500">{t("detail.noPhotos")}</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {task.photoSubmissions.map((photo) => (
                  <div key={photo.id} className="overflow-hidden rounded-lg border border-neutral-200">
                    {photo.mediaType === "VIDEO" ? (
                      <ProofMedia
                        url={photo.url}
                        mediaType={photo.mediaType}
                        className="h-48 w-full bg-neutral-100 object-cover"
                      />
                    ) : (
                      <a href={`/api/media/${photo.url}`} target="_blank" rel="noreferrer">
                        <ProofMedia
                          url={photo.url}
                          mediaType={photo.mediaType}
                          className="h-48 w-full bg-neutral-100 object-cover"
                        />
                      </a>
                    )}
                    <div className="space-y-2 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{formatDateTime(photo.takenAt)}</span>
                        <span className="text-neutral-500">{score(photo.qualityScore)}</span>
                      </div>
                      <div className="text-xs text-neutral-500">
                        {photo.mediaType === "VIDEO" ? t("detail.videoProof") : tReviews("photoProof")}
                        {photo.durationMs ? ` · ${Math.round(photo.durationMs / 1000)}s` : ""} · {photo.user.name}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {photo.humanReviews.length === 0 ? (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                            {t("detail.noReview")}
                          </span>
                        ) : (
                          photo.humanReviews.map((review) => (
                            <span
                              key={review.id}
                              className={`rounded px-1.5 py-0.5 text-xs ${statusClass(review.status)}`}
                            >
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

          <Panel title={t("detail.history")}>
            {task.statusHistory.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {task.statusHistory.map((item) => (
                  <div key={`${item.toStatus}-${item.createdAt.toISOString()}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="text-neutral-500">{formatDateTime(item.createdAt)}</span>
                    <span>
                      {item.fromStatus ? t(`status.${item.fromStatus}` as never) : "—"} →{" "}
                      <span className="font-medium">{t(`status.${item.toStatus}` as never)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("detail.comments")}>
            {task.comments.length === 0 ? (
              <div className="text-sm text-neutral-500">—</div>
            ) : (
              <div className="space-y-3">
                {task.comments.map((comment) => (
                  <div key={`${comment.user.name}-${comment.createdAt.toISOString()}`} className="rounded-lg bg-neutral-50 p-3">
                    <div className="text-sm text-neutral-800">{comment.body}</div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {comment.user.name} · {formatDateTime(comment.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title={tStores("detail.open")}>
            <div className="space-y-2 text-sm">
              <Link href={`/stores/${task.store.id}`} className="font-medium text-neutral-900 hover:underline">
                {task.store.name}
              </Link>
              <div className="text-neutral-500">
                {task.store.code ? `${task.store.code} · ` : ""}
                {task.store.address ?? "—"}
              </div>
              <div className="text-xs text-neutral-500">
                {[task.store.format?.name, task.store.region?.name].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
          </Panel>

          <Panel title={t("table.planogram")}>
            {task.planogramVersion ? (
              <div className="space-y-3 text-sm">
                <Link
                  href={`/planograms/${task.planogramVersion.planogram.id}/${task.planogramVersion.id}`}
                  className="font-medium hover:underline"
                >
                  {task.planogramVersion.planogram.name} · v{task.planogramVersion.versionNumber}
                </Link>
                <div className="grid grid-cols-2 gap-2 text-xs text-neutral-500">
                  <Metric label={t("detail.metrics.placements")} value={task.planogramVersion._count.placements} />
                  <Metric label={t("detail.metrics.equipment")} value={task.planogramVersion._count.equipment} />
                </div>
                <div className="text-xs text-neutral-500">
                  {tPlanograms(`state.${task.planogramVersion.state}` as never)} · {formatDate(task.planogramVersion.publishedAt)}
                </div>
              </div>
            ) : (
              <div className="text-sm text-neutral-500">—</div>
            )}
          </Panel>

          <Panel title={t("detail.reviews")}>
            {task.humanReviews.length === 0 ? (
              <div className="text-sm text-neutral-500">{t("detail.noReview")}</div>
            ) : (
              <div className="space-y-2 text-sm">
                {task.humanReviews.map((review) => (
                  <div key={review.id} className="rounded-lg bg-neutral-50 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(review.status)}`}>
                        {tReviews(`status.${review.status}` as never)}
                      </span>
                      <span className="text-xs text-neutral-500">{tReviews(`reason.${review.reason}` as never)}</span>
                      <span className="text-xs tabular-nums text-neutral-500">{score(review.score)}</span>
                    </div>
                    {review.note ? <div className="mt-1 text-xs text-neutral-600">{review.note}</div> : null}
                    <div className="mt-1 text-xs text-neutral-400">
                      {formatDateTime(review.reviewedAt ?? review.updatedAt)}
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
