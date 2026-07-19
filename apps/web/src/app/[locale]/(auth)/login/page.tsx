"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { fetchApiResponse } from "@/client/api-error"

export default function LoginPage() {
  const t = useTranslations("auth")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [organizationSlug, setOrganizationSlug] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [supportCode, setSupportCode] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setSupportCode(null)
    try {
      const res = await fetchApiResponse("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationSlug, email, password }),
      })
      if (res.ok) {
        // полный переход, чтобы middleware увидел свежие cookie
        const next = new URLSearchParams(window.location.search).get("next")
        const safeNext = next?.startsWith(`/${locale}/`) && !next.startsWith("//") ? next : `/${locale}`
        window.location.assign(safeNext)
        return
      }
      setSupportCode(res.headers.get("x-correlation-id") ?? "")
    } catch {
      setSupportCode("")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">
          {tc("appName")} — {t("title")}
        </h1>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-600">{t("organizationSlug")}</span>
          <input
            type="text"
            required
            autoComplete="organization"
            value={organizationSlug}
            onChange={(e) => setOrganizationSlug(e.target.value.toLowerCase())}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-600">{t("email")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-neutral-600">{t("password")}</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
        {supportCode !== null && (
          <p role="alert" className="text-sm text-red-600">
            {t("error")}
            {supportCode ? <> {t("supportCode", { value: supportCode })}</> : null}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? tc("loading") : t("submit")}
        </button>
      </form>
    </main>
  )
}
