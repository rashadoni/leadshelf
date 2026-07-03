import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"

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
          <table className="w-full text-sm">
            <tbody>
              {planograms.map((p) => {
                const v = p.versions[0]
                return (
                  <tr key={p.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
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
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{p.category?.name ?? "—"}</td>
                    <td className="px-3 py-2">
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
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {v?._count.placements ?? 0} {t("placements")}
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
