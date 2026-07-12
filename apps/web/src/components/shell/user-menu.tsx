"use client"

import { useLocale, useTranslations } from "next-intl"

export function UserMenu({ email }: { email: string }) {
  const t = useTranslations("auth")
  const locale = useLocale()

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.assign(`/${locale}/login`)
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="hidden max-w-48 truncate text-neutral-500 lg:inline">{email}</span>
      <button
        type="button"
        onClick={onLogout}
        className="min-h-8 rounded-md border border-neutral-300 px-2 text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {t("logout")}
      </button>
    </div>
  )
}
