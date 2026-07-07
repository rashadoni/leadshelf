import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { ReviewActions } from "./review-actions"

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const

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

function qualityIssues(findings: unknown): string[] {
  if (!findings || typeof findings !== "object" || Array.isArray(findings)) return []
  const qualityCheck = (findings as { qualityCheck?: unknown }).qualityCheck
  if (!qualityCheck || typeof qualityCheck !== "object" || Array.isArray(qualityCheck)) return []
  const issues = (qualityCheck as { issues?: unknown }).issues
  return Array.isArray(issues) ? issues.filter((issue): issue is string => typeof issue === "string") : []
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function hasEquipmentMismatch(flags: unknown): boolean {
  return (
    !!flags &&
    typeof flags === "object" &&
    !Array.isArray(flags) &&
    (flags as { equipmentMismatch?: unknown }).equipmentMismatch === true
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function visionDetails(findings: unknown) {
  const vision = asRecord(asRecord(findings).vision)
  if (Object.keys(vision).length === 0) return null
  const compliance = asRecord(vision.compliance)
  const nestedFindings = asRecord(vision.findings)
  const selectedFrames = Array.isArray(vision.selectedFrames) ? vision.selectedFrames.map(asRecord) : []
  const aiFindings = Array.isArray(vision.aiFindings) ? vision.aiFindings.map(asRecord) : []
  const missing = Array.isArray(nestedFindings.missing) ? nestedFindings.missing.map(asRecord) : []
  const wrong = Array.isArray(nestedFindings.wrong) ? nestedFindings.wrong.map(asRecord) : []
  const extra = Array.isArray(nestedFindings.extra) ? nestedFindings.extra.map(asRecord) : []
  return {
    provider: typeof vision.provider === "string" ? vision.provider : null,
    modelVersion: typeof vision.modelVersion === "string" ? vision.modelVersion : null,
    workerStatus: typeof vision.workerStatus === "string" ? vision.workerStatus : null,
    status: typeof vision.status === "string" ? vision.status : null,
    summary: typeof vision.summary === "string" ? vision.summary : null,
    warnings: stringList(vision.warnings),
    selectedFrames: selectedFrames
      .map((item) => ({
        key: typeof item.key === "string" ? item.key : null,
        timestampMs: typeof item.timestampMs === "number" ? item.timestampMs : null,
      }))
      .filter((item) => item.key),
    aiFindings: aiFindings
      .map((item) => ({
        type: typeof item.type === "string" ? item.type : null,
        severity: typeof item.severity === "string" ? item.severity : null,
        sku: typeof item.productSku === "string" ? item.productSku : null,
        note: typeof item.note === "string" ? item.note : null,
      }))
      .filter((item) => item.type || item.note),
    compliance: {
      status: typeof compliance.status === "string" ? compliance.status : null,
      score: typeof compliance.score === "number" ? compliance.score : null,
      totalSlots: typeof compliance.totalSlots === "number" ? compliance.totalSlots : null,
      matchedSlots: typeof compliance.matchedSlots === "number" ? compliance.matchedSlots : null,
      missingSlots: typeof compliance.missingSlots === "number" ? compliance.missingSlots : null,
      wrongProducts: typeof compliance.wrongProducts === "number" ? compliance.wrongProducts : null,
      extraDetections: typeof compliance.extraDetections === "number" ? compliance.extraDetections : null,
    },
    missing: missing
      .map((item) => ({
        slotId: typeof item.slotId === "string" ? item.slotId : null,
        sku: typeof item.expectedProductSku === "string" ? item.expectedProductSku : null,
      }))
      .filter((item) => item.slotId || item.sku),
    wrong: wrong
      .map((item) => ({
        slotId: typeof item.slotId === "string" ? item.slotId : null,
        expectedSku: typeof item.expectedProductSku === "string" ? item.expectedProductSku : null,
        detectedSku: typeof item.detectedProductSku === "string" ? item.detectedProductSku : null,
      }))
      .filter((item) => item.slotId || item.expectedSku || item.detectedSku),
    extra: extra
      .map((item) => ({
        slotId: typeof item.slotId === "string" ? item.slotId : null,
        sku: typeof item.detectedProductSku === "string" ? item.detectedProductSku : null,
      }))
      .filter((item) => item.slotId || item.sku),
  }
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const [t, tNav, session, params] = await Promise.all([
    getTranslations("reviews"),
    getTranslations("nav"),
    getSession(),
    searchParams,
  ])
  if (!session) return null

  const statusFilter = STATUSES.includes(params.status as never)
    ? (params.status as (typeof STATUSES)[number])
    : "PENDING"

  const db = tenantDb(session.org)
  const [reviews, summary] = await Promise.all([
    db.humanReview.findMany({
      where: { status: statusFilter },
      include: {
        task: {
          select: {
            title: true,
            status: true,
            store: { select: { name: true, code: true } },
            planogramVersion: {
              select: { id: true, planogram: { select: { id: true, name: true } }, versionNumber: true },
            },
          },
        },
        photoSubmission: {
          select: {
            url: true,
            mediaType: true,
            durationMs: true,
            analysisStatus: true,
            qualityScore: true,
            captureFlags: true,
            takenAt: true,
            store: { select: { name: true, code: true } },
            user: { select: { name: true } },
          },
        },
        planogramVersion: {
          select: { id: true, planogram: { select: { id: true, name: true } }, versionNumber: true },
        },
        goldenReference: { select: { id: true, imageUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    Promise.all([
      db.humanReview.count({ where: { status: "PENDING" } }),
      db.humanReview.count({ where: { status: "APPROVED" } }),
      db.humanReview.count({ where: { status: "REJECTED" } }),
      db.humanReview.count({ where: { reason: "PHOTO_QUALITY" } }),
      db.humanReview.count({ where: { reason: "VISION_COMPLIANCE" } }),
      db.humanReview.aggregate({ _avg: { score: true } }),
    ]).then(([pending, approved, rejected, photoQuality, visionCompliance, score]) => ({
      pending,
      approved,
      rejected,
      photoQuality,
      visionCompliance,
      avgScore: score._avg.score,
    })),
  ])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{tNav("reviews")}</h1>
        <span className="text-sm text-neutral-500">{t("subtitle")}</span>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["dashboard.pending", summary.pending],
          ["dashboard.approved", summary.approved],
          ["dashboard.rejected", summary.rejected],
          ["dashboard.avgScore", summary.avgScore === null ? "—" : `${Math.round(summary.avgScore * 100)}%`],
          ["dashboard.photoQuality", summary.photoQuality],
          ["dashboard.visionCompliance", summary.visionCompliance],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{t(label as never)}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {STATUSES.map((status) => (
          <Link
            key={status}
            href={`/reviews?status=${status}`}
            className={`rounded-full px-3 py-1 text-sm ${
              statusFilter === status
                ? "bg-neutral-900 text-white"
                : "border border-neutral-200 bg-white text-neutral-600"
            }`}
          >
            {t(`status.${status}`)}
          </Link>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            const photo = review.photoSubmission
            const issues = qualityIssues(review.findings)
            const vision = visionDetails(review.findings)
            const store = photo?.store ?? review.task?.store ?? null
            const planogramVersion = review.task?.planogramVersion ?? review.planogramVersion
            return (
              <div key={review.id} className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-3 md:grid-cols-[190px_1fr_auto]">
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                    {photo ? (
                      <ProofMedia
                        url={photo.url}
                        mediaType={photo.mediaType}
                        className="h-28 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-28 items-center justify-center text-xs text-neutral-400">
                        {t("noPhoto")}
                      </div>
                    )}
                    <div className="border-t border-neutral-200 px-2 py-1 text-[11px] text-neutral-500">
                      {photo?.mediaType === "VIDEO" ? t("videoProof") : t("photoProof")}
                      {photo?.durationMs ? ` · ${Math.round(photo.durationMs / 1000)}s` : ""}
                      {photo?.mediaType === "VIDEO" && photo.analysisStatus
                        ? ` · ${t(`analysisStatus.${photo.analysisStatus}` as never)}`
                        : ""}
                    </div>
                    {hasEquipmentMismatch(photo?.captureFlags) ? (
                      <div className="border-t border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                        {t("equipmentMismatch")}
                      </div>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                    {review.goldenReference ? (
                      <img src={`/api/media/${review.goldenReference.imageUrl}`} alt="" className="h-24 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-xs text-neutral-400">
                        {t("noReference")}
                      </div>
                    )}
                    <div className="border-t border-neutral-200 px-2 py-1 text-[11px] text-neutral-500">
                      {t("goldenReference")}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {t(`reason.${review.reason}`)}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {new Date(review.createdAt).toLocaleString()}
                    </span>
                    {review.score !== null && (
                      <span className="text-xs font-medium tabular-nums">
                        {Math.round(review.score * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="font-medium">
                    {review.task?.title ?? planogramVersion?.planogram.name ?? t("untitled")}
                  </div>
                  <div className="mt-1 text-sm text-neutral-500">
                    {store ? `${store.name}${store.code ? ` (${store.code})` : ""}` : t("unknownStore")}
                    {photo ? ` · ${photo.user.name} · ${photo.takenAt.toLocaleDateString()}` : ""}
                  </div>
                  {planogramVersion && (
                    <Link
                      href={`/planograms/${planogramVersion.planogram.id}/${planogramVersion.id}`}
                      className="mt-1 inline-block text-sm text-neutral-600 hover:underline"
                    >
                      {planogramVersion.planogram.name} · v{planogramVersion.versionNumber}
                    </Link>
                  )}
                  {issues.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {issues.map((issue) => (
                        <span key={issue} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">
                          {issue}
                        </span>
                      ))}
                    </div>
                  )}
                  {vision && (
                    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span className="font-medium text-neutral-700">{t("vision.title")}</span>
                        {vision.provider && <span>{vision.provider}</span>}
                        {vision.modelVersion && <span>{vision.modelVersion}</span>}
                        {vision.workerStatus && <span>{vision.workerStatus}</span>}
                        {vision.status && <span>{vision.status}</span>}
                      </div>
                      {vision.summary && <div className="mt-2 text-xs text-neutral-600">{vision.summary}</div>}
                      {vision.selectedFrames.length > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {vision.selectedFrames.slice(0, 6).map((frame) => (
                            <a
                              key={`${frame.key}-${frame.timestampMs}`}
                              href={`/api/media/${frame.key}`}
                              target="_blank"
                              rel="noreferrer"
                              className="overflow-hidden rounded border border-neutral-200 bg-white"
                            >
                              <img src={`/api/media/${frame.key}`} alt="" className="h-20 w-full object-cover" />
                              <div className="border-t border-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500">
                                {frame.timestampMs == null ? "frame" : `${(frame.timestampMs / 1000).toFixed(1)}s`}
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 grid gap-2 sm:grid-cols-5">
                        {[
                          ["vision.score", vision.compliance.score === null ? "—" : `${Math.round(vision.compliance.score * 100)}%`],
                          ["vision.matched", `${vision.compliance.matchedSlots ?? 0}/${vision.compliance.totalSlots ?? 0}`],
                          ["vision.missing", vision.compliance.missingSlots ?? 0],
                          ["vision.wrong", vision.compliance.wrongProducts ?? 0],
                          ["vision.extra", vision.compliance.extraDetections ?? 0],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded border border-neutral-200 bg-white px-2 py-1">
                            <div className="text-[11px] text-neutral-500">{t(label as never)}</div>
                            <div className="text-sm font-semibold tabular-nums">{value}</div>
                          </div>
                        ))}
                      </div>
                      {vision.missing.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {vision.missing.slice(0, 8).map((item) => (
                            <span key={`${item.slotId}-${item.sku}`} className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                              {t("vision.missingSku")}: {item.sku ?? item.slotId}
                            </span>
                          ))}
                        </div>
                      )}
                      {vision.wrong.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {vision.wrong.slice(0, 8).map((item) => (
                            <span key={`${item.slotId}-${item.expectedSku}-${item.detectedSku}`} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                              {t("vision.wrongSku")}: {item.expectedSku ?? item.slotId} → {item.detectedSku ?? "—"}
                            </span>
                          ))}
                        </div>
                      )}
                      {vision.extra.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {vision.extra.slice(0, 8).map((item) => (
                            <span key={`${item.slotId}-${item.sku}`} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                              {t("vision.extraSku")}: {item.sku ?? item.slotId}
                            </span>
                          ))}
                        </div>
                      )}
                      {vision.aiFindings.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {vision.aiFindings.slice(0, 6).map((item, index) => (
                            <div key={`${item.type}-${index}`} className="rounded bg-white px-2 py-1 text-xs text-neutral-600">
                              <span className="font-medium text-neutral-800">{item.type ?? t("vision.finding")}</span>
                              {item.sku ? ` · ${item.sku}` : ""}
                              {item.note ? ` · ${item.note}` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                      {vision.warnings.length > 0 && (
                        <div className="mt-2 text-xs text-neutral-500">
                          {t("vision.warnings")}: {vision.warnings.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-end">
                  {review.status === "PENDING" ? (
                    <ReviewActions reviewId={review.id} />
                  ) : (
                    <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
                      {t(`status.${review.status}`)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
