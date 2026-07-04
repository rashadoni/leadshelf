import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { LocaleSwitcher } from "./locale-switcher"
import { ShellBreadcrumbs, ShellNav } from "./shell-navigation"
import { UserMenu } from "./user-menu"

export async function DashboardShell({
  children,
  userEmail,
}: {
  children: ReactNode
  userEmail: string
}) {
  const tc = await getTranslations("common")

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-950 md:flex-row">
      <aside className="border-b border-neutral-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-neutral-200 p-4 md:block">
          <div className="text-lg font-bold">{tc("appName")}</div>
          <div className="mt-1 text-xs text-neutral-500">{tc("workspace")}</div>
        </div>
        <ShellNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <ShellBreadcrumbs />
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              {tc("demoTenant")}
            </span>
            <LocaleSwitcher />
            <UserMenu email={userEmail} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
