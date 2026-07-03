import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { EquipmentPreviewSvg } from "./equipment-preview-svg"

export default async function EquipmentLibraryPage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("equipment"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const templates = await tenantDb(session.org).equipmentTemplate.findMany({
    include: {
      type: { select: { name: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { shelves: { orderBy: { shelfIndex: "asc" } } },
      },
    },
    orderBy: [{ name: "asc" }],
    take: 100,
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tNav("equipmentLibrary")}</h1>
        <Link
          href="/equipment-library/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + {t("createNew")}
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((tpl) => {
            const v = tpl.versions[0]
            return (
              <Link
                key={tpl.id}
                href={`/equipment-library/${tpl.id}`}
                className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
              >
                <div className="flex justify-center">
                  {v && (
                    <EquipmentPreviewSvg
                      widthMm={v.widthMm}
                      heightMm={v.heightMm}
                      shelves={v.shelves}
                      maxPx={140}
                    />
                  )}
                </div>
                <div className="mt-3 font-medium">{tpl.name}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                  <span>{tpl.type.name}</span>
                  {v && (
                    <span>
                      {v.widthMm}×{v.heightMm}×{v.depthMm} · {v.shelves.length}{" "}
                      {t("table.shelves").toLowerCase()}
                    </span>
                  )}
                </div>
                {v && (
                  <div className="mt-2 text-xs">
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        v.isFrozen
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      v{v.versionNumber} · {v.isFrozen ? t("badge.frozen") : t("badge.draft")}
                    </span>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
