"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { fetchApiResponse, formatApiError, requireApiResponse } from "@/client/api-error"

export function UserMenu({ email }: { email: string }) {
  const t = useTranslations("auth")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [error, setError] = useState<string | null>(null)

  async function onLogout() {
    setError(null)
    try {
      const response = await fetchApiResponse("/api/auth/logout", { method: "POST" })
      requireApiResponse(response)
      window.location.assign(`/${locale}/login`)
    } catch (caught) {
      setError(formatApiError(caught, tc("actionFailed"), (value) => tc("supportCode", { value })))
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden max-w-48 truncate text-neutral-500 lg:inline">{email}</span>
        <button
          type="button"
          onClick={onLogout}
          className="min-h-8 rounded-md border border-neutral-300 px-2 text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {t("logout")}
        </button>
      </div>
      {error ? <span role="alert" className="max-w-72 text-right text-xs text-red-700">{error}</span> : null}
    </div>
  )
}
