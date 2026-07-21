"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

export interface PublishTargetOption {
  formats: Array<{ id: string; name: string; storeCount: number }>
  stores: Array<{ id: string; name: string; code: string | null }>
}

export function PublishDialog({
  options,
  revision,
  publishUrl,
  onPublished,
  onError,
}: {
  options: PublishTargetOption
  revision: string
  publishUrl: string
  onPublished: (taskCount: number) => void
  onError: (message: string) => void
}) {
  const t = useTranslations("planograms.publish")
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"FORMAT" | "STORES">("FORMAT")
  const [formatId, setFormatId] = useState(options.formats[0]?.id ?? "")
  const [storeIds, setStoreIds] = useState<string[]>([])
  const [dueAt, setDueAt] = useState("")
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    const res = await fetchApiResponse(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: revision,
        target:
          mode === "FORMAT" ? { type: "FORMAT", formatId } : { type: "STORES", storeIds },
        dueAt: dueAt ? new Date(`${dueAt}T18:00:00Z`).toISOString() : null,
        changeNote: note || undefined,
      }),
    })
    setPending(false)
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      setOpen(false)
      onPublished(body.resolvedStoreCount as number)
    } else {
      onError(formatResponseError(
        res,
        body.message ?? body.error ?? `HTTP ${res.status}`,
        (value) => tc("supportCode", { value }),
      ))
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-600"
      >
        {t("button")}
      </button>
    )
  }

  const selectedFormat = options.formats.find((f) => f.id === formatId)
  const canSubmit = mode === "FORMAT" ? !!formatId : storeIds.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-xs text-neutral-500">{t("willFreeze")}</p>

        <div className="flex gap-1 rounded-md bg-neutral-100 p-1 text-sm">
          {(["FORMAT", "STORES"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded px-3 py-1 ${mode === m ? "bg-white shadow-sm" : "text-neutral-500"}`}
            >
              {m === "FORMAT" ? t("targetFormat") : t("targetStores")}
            </button>
          ))}
        </div>

        {mode === "FORMAT" ? (
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-600">{t("format")}</span>
            <select
              value={formatId}
              onChange={(e) => setFormatId(e.target.value)}
              className="block w-full rounded-md border border-neutral-300 px-3 py-1.5"
            >
              {options.formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({t("storesCount", { count: f.storeCount })})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 text-sm">
            {options.stores.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={storeIds.includes(s.id)}
                  onChange={(e) =>
                    setStoreIds((prev) =>
                      e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                    )
                  }
                />
                <span>
                  {s.name} {s.code && <span className="text-neutral-400">({s.code})</span>}
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="block space-y-1 text-sm">
          <span className="text-neutral-600">{t("dueAt")}</span>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="block rounded-md border border-neutral-300 px-3 py-1.5"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-600">{t("note")}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="block w-full rounded-md border border-neutral-300 px-3 py-1.5"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
          <button
            onClick={submit}
            disabled={pending || !canSubmit}
            className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? t("publishing") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  )
}
