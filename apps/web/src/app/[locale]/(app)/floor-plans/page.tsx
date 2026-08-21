import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { CopyToStoreButton } from "./copy-to-store-button"
import { FloorPlanForm } from "./floor-plan-form"

function formatTarget(floorPlan: {
  store: { name: string; code: string | null } | null
  format: { name: string } | null
}): string {
  if (floorPlan.store) {
    return floorPlan.store.code ? `${floorPlan.store.name} (${floorPlan.store.code})` : floorPlan.store.name
  }
  return floorPlan.format?.name ?? "—"
}

export default async function FloorPlansPage() {
  const [t, session] = await Promise.all([getTranslations("floorPlans"), getSession()])
  if (!session) return null

  const db = tenantDb(session.org)
  const [floorPlans, stores, formats, templates, planograms] = await Promise.all([
    db.floorPlan.findMany({
    include: {
              store: { select: { name: true, code: true } },
              format: { select: { name: true } },
      versions: {
        where: { isPublished: true },
        orderBy: [{ versionNumber: "desc" }],
        take: 1,
        include: {
          equipment: {
            include: {
              planogram: { select: { name: true } },
              equipmentVersion: {
                select: {
                  id: true,
                  widthMm: true,
                  depthMm: true,
                  template: { select: { name: true } },
                },
              },
            },
            orderBy: [{ label: "asc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 100,
    }),
    db.store.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    db.storeFormat.findMany({ orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
    db.equipmentTemplate.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { id: true, widthMm: true, depthMm: true },
        },
      },
    }),
    db.planogram.findMany({ orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
  ])
  const equipment = templates.flatMap((template) => {
    const version = template.versions[0]
    return version
      ? [{ id: template.id, name: template.name, versionId: version.id, widthMm: version.widthMm, depthMm: version.depthMm }]
      : []
  })
  const knownEquipmentVersions = new Set(equipment.map((item) => item.versionId))
  for (const floorPlan of floorPlans) {
    for (const item of floorPlan.versions[0]?.equipment ?? []) {
      if (knownEquipmentVersions.has(item.equipmentVersion.id)) continue
      equipment.push({
        id: item.equipmentVersion.id,
        name: item.equipmentVersion.template.name,
        versionId: item.equipmentVersion.id,
        widthMm: item.equipmentVersion.widthMm,
        depthMm: item.equipmentVersion.depthMm,
      })
      knownEquipmentVersions.add(item.equipmentVersion.id)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">{t("subtitle")}</p>
      </div>
      <details className="mb-5 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
          {t("form.createNew")}
        </summary>
        <FloorPlanForm stores={stores} formats={formats} equipment={equipment} planograms={planograms} />
      </details>

      {floorPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <div className="grid gap-5">
          {floorPlans.map((floorPlan) => {
            const version = floorPlan.versions[0]
            const initial =
              version && (floorPlan.store || floorPlan.format)
                ? {
                    name: floorPlan.name,
                    targetType: floorPlan.store ? ("store" as const) : ("format" as const),
                    targetId: floorPlan.storeId ?? floorPlan.formatId ?? "",
                    widthMm: version.widthMm,
                    depthMm: version.depthMm,
                    equipment: version.equipment.map((item) => ({
                      equipmentVersionId: item.equipmentVersion.id,
                      planogramId: item.planogramId ?? "",
                      label: item.label ?? item.equipmentVersion.template.name,
                      xMm: item.xMm,
                      yMm: item.yMm,
                      rotationDeg: item.rotationDeg,
                      isLocked: item.isLocked,
                      widthMm: item.equipmentVersion.widthMm,
                      depthMm: item.equipmentVersion.depthMm,
                    })),
                  }
                : null

            return (
              <section key={floorPlan.id} className="rounded-xl border border-neutral-200 bg-white">
                <div className="border-b border-neutral-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{floorPlan.name}</h2>
                      <p className="mt-0.5 text-xs text-neutral-500">{formatTarget(floorPlan)}</p>
                    </div>
                    {version ? (
                      <span className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
                        v{version.versionNumber}
                      </span>
                    ) : null}
                  </div>
                  {floorPlan.format ? (
                    <div className="mt-3">
                      <CopyToStoreButton floorPlanId={floorPlan.id} stores={stores} />
                    </div>
                  ) : null}
                </div>
                {!version ? (
                  <div className="p-10 text-center text-sm text-neutral-500">{t("noPublished")}</div>
                ) : initial ? (
                    <FloorPlanForm
                      floorPlanId={floorPlan.id}
                      initial={initial}
                      variant="inline"
                      stores={stores}
                      formats={formats}
                      equipment={equipment}
                      planograms={planograms}
                    />
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
