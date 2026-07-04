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
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <span className="max-w-48 truncate text-neutral-500">{email}</span>
      <button
        onClick={onLogout}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
      >
        {t("logout")}
      </button>
    </div>
  )
}
