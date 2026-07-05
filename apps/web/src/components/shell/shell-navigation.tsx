"use client"

import { useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/navigation"
import { NAV_ITEMS, type NavKey } from "./nav-items"

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/"
  const normalized = pathname.replace(/\/$/, "")
  return normalized === "" ? "/" : normalized
}

function isActivePath(pathname: string, href: string) {
  const current = normalizePath(pathname)
  const target = normalizePath(href)
  if (target === "/") return current === "/"
  return current === target || current.startsWith(`${target}/`)
}

function currentNavKey(pathname: string): NavKey {
  const current = normalizePath(pathname)
  const matched = [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isActivePath(current, item.href))
  return matched?.key ?? "overview"
}

export function ShellNav() {
  const pathname = usePathname()
  const t = useTranslations("nav")

  return (
    <nav className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-0.5 lg:overflow-visible">
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href)
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm transition ${
              active
                ? "bg-neutral-900 font-medium text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
            }`}
          >
            {t(item.key)}
          </Link>
        )
      })}
    </nav>
  )
}

export function ShellBreadcrumbs() {
  const pathname = usePathname()
  const tNav = useTranslations("nav")
  const tCommon = useTranslations("common")
  const navKey = currentNavKey(pathname)
  const current = NAV_ITEMS.find((item) => item.key === navKey) ?? NAV_ITEMS[0]
  const nested = normalizePath(pathname) !== normalizePath(current.href)

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
        <Link href="/" className="shrink-0 hover:text-neutral-900">
          {tNav("overview")}
        </Link>
        {navKey !== "overview" ? (
          <>
            <span className="text-neutral-300">/</span>
            <Link href={current.href} className="truncate hover:text-neutral-900">
              {tNav(navKey)}
            </Link>
          </>
        ) : null}
        {nested ? (
          <>
            <span className="text-neutral-300">/</span>
            <span className="truncate text-neutral-700">{tCommon("details")}</span>
          </>
        ) : null}
      </div>
      <div className="mt-1 truncate text-sm font-medium text-neutral-900">
        {navKey === "overview" ? tCommon("workspace") : tNav(navKey)}
      </div>
    </div>
  )
}
