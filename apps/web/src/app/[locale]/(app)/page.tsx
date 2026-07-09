import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import { getSession } from "@/server/auth/require-session"
import { tenantDb, workerDb } from "@/server/db/client"
import { PlanogramThumbnail } from "./planograms/planogram-thumbnail"

function qualityTone(value: number) {
  if (value === 0) return "bg-emerald-50 text-emerald-700"
  if (value < 5) return "bg-amber-50 text-amber-700"
  return "bg-red-50 text-red-600"
}

export default async function OverviewPage() {
  const [t, session] = await Promise.all([getTranslations("dashboard"), getSession()])
  if (!session) return null

  const db = tenantDb(session.org)
  const [
    products,
    readyProducts,
    missingDimensions,
    missingImages,
    stores,
    floorPlans,
    equipmentTemplates,
    planograms,
    publishedPlanograms,
    openTasks,
    photoSubmittedTasks,
    pendingReviews,
    photoSubmissions,
    heroPlanogram,
    heroPhoto,
  ] = await Promise.all([
    db.product.count({ where: { isActive: true } }),
    db.product.count({
      where: {
        isActive: true,
        widthMm: { not: null },
        heightMm: { not: null },
        depthMm: { not: null },
        barcodes: { some: {} },
      },
    }),
    db.product.count({
      where: {
        isActive: true,
        OR: [{ widthMm: null }, { heightMm: null }, { depthMm: null }],
      },
    }),
    db.product.count({ where: { isActive: true, images: { none: {} } } }),
    db.store.count({ where: { isActive: true } }),
    db.floorPlan.count(),
    db.equipmentTemplate.count(),
    db.planogram.count(),
    db.planogram.count({ where: { versions: { some: { state: "PUBLISHED" } } } }),
    db.task.count({ where: { status: { in: ["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"] } } }),
    db.task.count({ where: { status: "PHOTO_SUBMITTED" } }),
    db.humanReview.count({ where: { status: "PENDING" } }),
    db.photoSubmission.count(),
    // PlanogramVersion не имеет organizationId — tenantDb его запрещает.
    // Скоуп по тенанту через parent-path (planogram.organizationId) на workerDb,
    // как в planogram-editor и golden-reference роутах.
    workerDb.planogramVersion.findFirst({
      where: { state: "PUBLISHED", planogram: { organizationId: session.org } },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        versionNumber: true,
        planogram: { select: { id: true, name: true } },
        equipment: {
          select: {
            equipmentVersion: {
              select: { shelves: { select: { shelfIndex: true, yMm: true, thicknessMm: true }, take: 12 } },
            },
          },
          take: 1,
        },
        placements: {
          select: { xMm: true, yMm: true, widthMm: true, heightMm: true, facingsX: true, facingsY: true, productId: true },
          take: 80,
        },
      },
    }),
    db.photoSubmission.findFirst({
      orderBy: { takenAt: "desc" },
      select: { url: true, mediaType: true, store: { select: { name: true } } },
    }),
  ])

  const readiness = products === 0 ? 0 : Math.round((readyProducts / products) * 100)
  const cards = [
    { label: t("kpi.products"), value: products, hint: t("kpi.ready", { value: readiness }) },
    { label: t("kpi.stores"), value: stores, hint: t("kpi.floorPlans", { value: floorPlans }) },
    { label: t("kpi.equipment"), value: equipmentTemplates, hint: t("kpi.planograms", { value: planograms }) },
    {
      label: t("kpi.published"),
      value: publishedPlanograms,
      hint: t("kpi.openTasks", { value: openTasks }),
    },
    {
      label: t("kpi.photoProof"),
      value: photoSubmissions,
      hint: t("kpi.pendingReviews", { value: pendingReviews }),
    },
  ]
  const flow = [
    { label: t("flow.catalog"), href: "/catalog", done: products > 0, value: products },
    { label: t("flow.equipment"), href: "/equipment-library", done: equipmentTemplates > 0, value: equipmentTemplates },
    { label: t("flow.floorPlan"), href: "/floor-plans", done: floorPlans > 0, value: floorPlans },
    { label: t("flow.planogram"), href: "/planograms", done: publishedPlanograms > 0, value: publishedPlanograms },
    { label: t("flow.task"), href: "/tasks", done: openTasks > 0, value: openTasks },
    { label: t("flow.review"), href: "/reviews", done: photoSubmittedTasks > 0, value: pendingReviews },
  ]

  return (
    <div className="space-y-6">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{t("subtitle")}</p>
      </div>

      {(heroPlanogram || heroPhoto) && (
        <section className="grid gap-4 md:grid-cols-2">
          {heroPlanogram ? (
            <Link
              href={`/planograms/${heroPlanogram.planogram.id}/${heroPlanogram.id}`}
              className="rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("hero.planogram")}</div>
              <div className="mt-1 text-sm font-medium">
                {heroPlanogram.planogram.name} · v{heroPlanogram.versionNumber}
              </div>
              <PlanogramThumbnail
                className="mt-2 h-44 w-full"
                shelves={heroPlanogram.equipment[0]?.equipmentVersion.shelves ?? []}
                placements={heroPlanogram.placements}
              />
            </Link>
          ) : null}
          {heroPhoto ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t("hero.photo")}</div>
              <div className="mt-1 text-sm text-neutral-500">{heroPhoto.store?.name ?? ""}</div>
              {heroPhoto.mediaType === "VIDEO" ? (
                <video
                  className="mt-2 h-44 w-full rounded-md border border-neutral-200 bg-neutral-900 object-cover"
                  muted
                  playsInline
                  preload="metadata"
                >
                  <source src={`/api/media/${heroPhoto.url}`} />
                </video>
              ) : (
                <img
                  src={`/api/media/${heroPhoto.url}`}
                  alt=""
                  className="mt-2 h-44 w-full rounded-md border border-neutral-200 bg-neutral-100 object-cover"
                />
              )}
            </div>
          ) : null}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-sm text-neutral-500">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{card.value}</div>
            <div className="mt-1 text-xs text-neutral-500">{card.hint}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="font-semibold">{t("flow.title")}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t("flow.hint")}</p>
          </div>
          <div className="divide-y divide-neutral-100">
            {flow.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className="grid grid-cols-[32px_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    item.done ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-neutral-500">
                    {item.done ? t("flow.ready") : t("flow.needsData")}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-neutral-700">{item.value}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="font-semibold">{t("quality.title")}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t("quality.hint")}</p>
          </div>
          <div className="space-y-3 p-4">
            <Link
              href="/catalog?missingDimensions=true"
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 hover:bg-neutral-50"
            >
              <span className="text-sm">{t("quality.missingDimensions")}</span>
              <span className={`rounded px-2 py-1 text-xs font-medium tabular-nums ${qualityTone(missingDimensions)}`}>
                {missingDimensions}
              </span>
            </Link>
            <Link
              href="/catalog?missingImage=true"
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 hover:bg-neutral-50"
            >
              <span className="text-sm">{t("quality.missingImages")}</span>
              <span className={`rounded px-2 py-1 text-xs font-medium tabular-nums ${qualityTone(missingImages)}`}>
                {missingImages}
              </span>
            </Link>
            <Link
              href="/reviews?status=PENDING"
              className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 hover:bg-neutral-50"
            >
              <span className="text-sm">{t("quality.pendingReviews")}</span>
              <span className={`rounded px-2 py-1 text-xs font-medium tabular-nums ${qualityTone(pendingReviews)}`}>
                {pendingReviews}
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
