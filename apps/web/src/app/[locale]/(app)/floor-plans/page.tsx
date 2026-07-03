import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"

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

  const floorPlans = await tenantDb(session.org).floorPlan.findMany({
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
  })

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">{t("subtitle")}</p>
      </div>

      {floorPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {floorPlans.map((floorPlan) => {
            const version = floorPlan.versions[0]
            const scale = version ? Math.min(760 / version.widthMm, 420 / version.depthMm) : 1
            const width = version ? Math.max(320, Math.round(version.widthMm * scale)) : 480
            const height = version ? Math.max(220, Math.round(version.depthMm * scale)) : 260

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
                </div>
                {!version ? (
                  <div className="p-10 text-center text-sm text-neutral-500">{t("noPublished")}</div>
                ) : (
                  <div className="p-4">
                    <svg
                      viewBox={`0 0 ${width} ${height}`}
                      width={width}
                      height={height}
                      className="max-w-full rounded-md border border-neutral-200 bg-neutral-50"
                    >
                      <rect x={0} y={0} width={width} height={height} fill="#fafafa" />
                      {version.equipment.map((item) => {
                        const eqWidth = Math.max(12, item.equipmentVersion.widthMm * scale)
                        const eqDepth = Math.max(12, item.equipmentVersion.depthMm * scale)
                        const x = item.xMm * scale
                        const y = item.yMm * scale
                        return (
                          <g
                            key={item.id}
                            transform={`translate(${x} ${y}) rotate(${item.rotationDeg} ${eqWidth / 2} ${eqDepth / 2})`}
                          >
                            <rect
                              width={eqWidth}
                              height={eqDepth}
                              rx={3}
                              fill={item.planogram ? "#dbeafe" : "#e5e7eb"}
                              stroke={item.planogram ? "#2563eb" : "#9ca3af"}
                            />
                            <text x={6} y={16} fontSize={11} fill="#111827">
                              {item.label ?? item.equipmentVersion.template.name}
                            </text>
                            {item.planogram ? (
                              <text x={6} y={32} fontSize={10} fill="#2563eb">
                                {item.planogram.name}
                              </text>
                            ) : null}
                          </g>
                        )
                      })}
                    </svg>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                      <span>
                        {version.widthMm}×{version.depthMm} mm
                      </span>
                      <span>{t("equipmentCount", { count: version.equipment.length })}</span>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
