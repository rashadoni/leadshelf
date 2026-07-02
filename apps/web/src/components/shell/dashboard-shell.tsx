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
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 p-4 text-lg font-bold">
          {tc("appName")}
        </div>
        <nav className="space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
          <LocaleSwitcher />
          <UserMenu email={userEmail} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
