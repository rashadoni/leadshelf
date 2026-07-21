"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

interface Dims {
  widthMm: number | null
  heightMm: number | null
  depthMm: number | null
  weightG: number | null
}

export function DimensionsEditor({ productId, dims }: { productId: string; dims: Dims }) {
  const t = useTranslations("catalog.dims")
  const tc = useTranslations("common")
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState({
    widthMm: dims.widthMm?.toString() ?? "",
    heightMm: dims.heightMm?.toString() ?? "",
    depthMm: dims.depthMm?.toString() ?? "",
    weightG: dims.weightG?.toString() ?? "",
  })

  if (!editing) {
    const hasDims = dims.widthMm != null && dims.heightMm != null && dims.depthMm != null
    return (
      <button
        onClick={() => setEditing(true)}
        title={t("edit")}
        className={`rounded px-2 py-1 text-xs hover:bg-neutral-100 ${
          hasDims ? "text-neutral-700" : "text-amber-600"
        }`}
      >
        {hasDims ? `${dims.widthMm}×${dims.heightMm}×${dims.depthMm}` : `⚠ ${t("edit")}`}
      </button>
    )
  }

  async function save() {
    setPending(true)
    setError(null)
    const toInt = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10))
    const res = await fetchApiResponse(`/api/v1/catalog/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widthMm: toInt(values.widthMm),
        heightMm: toInt(values.heightMm),
        depthMm: toInt(values.depthMm),
        weightG: toInt(values.weightG),
      }),
    })
    setPending(false)
    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      setError(formatResponseError(res, tc("actionFailed"), (value) => tc("supportCode", { value })))
    }
  }

  const fields = [
    ["widthMm", t("width")],
    ["heightMm", t("height")],
    ["depthMm", t("depth")],
    ["weightG", t("weightG")],
  ] as const

  return (
    <div className="flex flex-wrap items-center gap-1">
      {fields.map(([key, label]) => (
        <input
          key={key}
          type="number"
          min={1}
          placeholder={label}
          value={values[key]}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
          className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs"
        />
      ))}
      <button
        onClick={save}
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        {t("save")}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="rounded px-2 py-1 text-xs text-neutral-500"
      >
        {t("cancel")}
      </button>
      {error ? <span role="alert" className="basis-full text-xs text-red-700">{error}</span> : null}
    </div>
  )
}
