import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"

const TABS = [
  { key: "products", href: "/catalog" },
  { key: "import", href: "/catalog/import" },
  { key: "quality", href: "/catalog/quality" },
] as const

export async function CatalogTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  const t = await getTranslations("catalog.tabs")
  return (
    <div className="mb-6 flex gap-1 border-b border-neutral-200">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${
            tab.key === active
              ? "border-neutral-900 font-medium text-neutral-900"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          {t(tab.key)}
        </Link>
      ))}
    </div>
  )
}
