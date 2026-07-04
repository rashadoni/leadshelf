import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import { NAV_ITEMS } from "./nav-items"
import { LocaleSwitcher } from "./locale-switcher"
import { UserMenu } from "./user-menu"

export async function DashboardShell({
  children,
  userEmail,
}: {
  children: ReactNode
  userEmail: string
}) {
  const t = await getTranslations("nav")
  const tc = await getTranslations("common")

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-neutral-200 bg-white md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-neutral-200 p-4 text-lg font-bold md:block">
          {tc("appName")}
        </div>
        <nav className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block whitespace-nowrap rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3 md:px-6">
          <LocaleSwitcher />
          <UserMenu email={userEmail} />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
