"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

export function NewPlanogramForm({
  templates,
}: {
  templates: Array<{ id: string; name: string; dims: string }>
}) {
  const t = useTranslations("planograms.new")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetchApiResponse("/api/v1/planograms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, equipmentTemplateId: templateId }),
    })
    if (res.ok) {
      const body = await res.json()
      window.location.assign(`/${locale}/planograms/${body.planogramId}/${body.versionId}`)
    } else {
      setPending(false)
      setError(formatResponseError(res, `HTTP ${res.status}`, (value) => tc("supportCode", { value })))
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-600">{t("name")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="block w-full rounded-md border border-neutral-300 px-3 py-1.5"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-600">{t("equipment")}</span>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="block w-full rounded-md border border-neutral-300 px-3 py-1.5"
        >
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name} ({tpl.dims})
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? t("creating") : t("create")}
      </button>
    </form>
  )
}
