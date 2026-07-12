import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { HelpVideoButton } from "@/components/help/help-video-button"
import { LocaleSwitcher } from "./locale-switcher"
import { ShellBreadcrumbs, ShellNav } from "./shell-navigation"
import { UserMenu } from "./user-menu"

export async function DashboardShell({
  children,
  userEmail,
  demoReady,
}: {
  children: ReactNode
  userEmail: string
  demoReady: boolean
}) {
  const tc = await getTranslations("common")

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-950 lg:flex-row">
      <aside className="border-b border-neutral-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="border-b border-neutral-200 px-4 py-3 lg:p-4">
          <div className="text-lg font-bold">{tc("appName")}</div>
          <div className="mt-1 hidden text-xs text-neutral-500 sm:block">{tc("workspace")}</div>
        </div>
        <ShellNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-12 items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur md:min-h-14 md:px-6">
          <ShellBreadcrumbs />
          <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
            {demoReady ? (
              <span className="hidden rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 md:inline-flex">
                {tc("demoTenant")}
              </span>
            ) : null}
            <HelpVideoButton />
            <LocaleSwitcher />
            <UserMenu email={userEmail} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
