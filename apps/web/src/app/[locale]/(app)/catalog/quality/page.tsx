import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { getCatalogQuality } from "@/server/services/catalog-stats"
import { Link } from "@/i18n/navigation"
import { CatalogTabs } from "../catalog-tabs"

export default async function CatalogQualityPage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("catalog.quality"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const { products, recentBatches } = await getCatalogQuality(session.org)

  const cards = [
    { label: t("total"), value: products.total, href: "/catalog", tone: "neutral" },
    {
      label: t("planogramReady"),
      value: products.planogramReady,
      href: "/catalog",
      tone: "green",
    },
    {
      label: t("missingDimensions"),
      value: products.missingDimensions,
      href: "/catalog?missingDimensions=true",
      tone: "amber",
    },
    {
      label: t("missingBarcode"),
      value: products.missingBarcode,
      href: "/catalog?missingBarcode=true",
      tone: "amber",
    },
    {
      label: t("missingImage"),
      value: products.missingImage,
      href: "/catalog?missingImage=true",
      tone: "amber",
    },
    { label: t("missingCategory"), value: products.missingCategory, href: "/catalog", tone: "amber" },
  ] as const

  const toneClass = { neutral: "text-neutral-900", green: "text-green-700", amber: "text-amber-600" }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{tNav("catalog")}</h1>
      <CatalogTabs active="quality" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
          >
            <div className={`text-2xl font-semibold ${toneClass[c.tone]}`}>{c.value}</div>
            <div className="mt-1 text-xs text-neutral-500">{c.label}</div>
          </Link>
        ))}
      </div>

      <h2 className="mb-2 mt-8 text-lg font-medium">{t("recentImports")}</h2>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-[860px] text-sm">
          <tbody>
            {recentBatches.map((b) => (
              <tr key={b.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2 text-neutral-500">
                  {new Date(b.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{b.entityType}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      b.status === "COMPLETED"
                        ? "text-green-700"
                        : b.status === "FAILED"
                          ? "text-red-600"
                          : "text-amber-600"
                    }
                  >
                    {t(`batchStatus.${b.status}` as never)}
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-500">
                  {b.totalRows} / <span className="text-red-600">{b.errorRows}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
