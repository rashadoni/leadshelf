"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { MoreHorizontal, X } from "lucide-react"
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

const MOBILE_PRIMARY_KEYS: NavKey[] = ["overview", "tasks", "fieldForce", "orders"]

export function ShellNav() {
  const pathname = usePathname()
  const t = useTranslations("nav")
  const tc = useTranslations("common")
  const [moreOpen, setMoreOpen] = useState(false)
  const mobilePrimary = NAV_ITEMS.filter((item) => MOBILE_PRIMARY_KEYS.includes(item.key))
  const mobileSecondary = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY_KEYS.includes(item.key))
  const secondaryActive = mobileSecondary.some((item) => isActivePath(pathname, item.href))

  function navClass(active: boolean, compact = false) {
    return `${compact
      ? "flex min-h-11 items-center justify-center px-1 text-center text-[11px] leading-4"
      : "block px-3 py-2 text-sm"
    } whitespace-normal rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
      active
        ? "bg-indigo-600 font-medium text-white"
        : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
    }`
  }

  return (
    <>
      <div className="p-2 lg:hidden">
        <nav aria-label={tc("mainNavigation")} className="grid grid-cols-5 gap-1">
          {mobilePrimary.map((item) => {
            const active = isActivePath(pathname, item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMoreOpen(false)}
                className={navClass(active, true)}
              >
                {item.key === "fieldForce" ? tc("fieldForceShort") : t(item.key)}
              </Link>
            )
          })}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-navigation"
            onClick={() => setMoreOpen((open) => !open)}
            className={navClass(secondaryActive || moreOpen, true)}
          >
            <span className="inline-flex items-center gap-1">
              {moreOpen
                ? <X className="h-3.5 w-3.5" aria-hidden="true" />
                : <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
              {tc("more")}
            </span>
          </button>
        </nav>
        {moreOpen ? (
          <nav
            id="mobile-more-navigation"
            aria-label={tc("moreNavigation")}
            className="mt-2 grid grid-cols-2 gap-1 border-t border-neutral-100 pt-2"
          >
            {mobileSecondary.map((item) => {
              const active = isActivePath(pathname, item.href)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={navClass(active)}
                >
                  {t(item.key)}
                </Link>
              )
            })}
          </nav>
        ) : null}
      </div>

      <nav aria-label={tc("mainNavigation")} className="hidden p-2 lg:block lg:space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href)
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={navClass(active)}
            >
              {t(item.key)}
            </Link>
          )
        })}
      </nav>
    </>
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
        <Link
          href="/"
          className="shrink-0 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {tNav("overview")}
        </Link>
        {navKey !== "overview" ? (
          <>
            <span className="text-neutral-300">/</span>
            <Link
              href={current.href}
              className="truncate hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
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
      <div className="mt-1 hidden truncate text-sm font-medium text-neutral-900 sm:block">
        {navKey === "overview" ? tCommon("workspace") : tNav(navKey)}
      </div>
    </div>
  )
}
