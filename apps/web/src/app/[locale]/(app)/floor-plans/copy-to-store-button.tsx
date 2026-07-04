"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function CopyToStoreButton({
  floorPlanId,
  stores,
}: {
  floorPlanId: string
  stores: Array<{ id: string; name: string; code: string | null }>
}) {
  const t = useTranslations("floorPlans.form")
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [pending, setPending] = useState(false)

  async function copy() {
    if (!storeId) return
    setPending(true)
    const response = await fetch(`/api/v1/floor-plans/${floorPlanId}/copy-to-store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    })
    setPending(false)
    if (response.ok) router.refresh()
  }

  if (stores.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <select
        value={storeId}
        onChange={(event) => setStoreId(event.target.value)}
        className="max-w-44 rounded border border-neutral-300 px-2 py-1 text-xs"
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.code ? `${store.name} (${store.code})` : store.name}
          </option>
        ))}
      </select>
      <button
        onClick={copy}
        disabled={pending}
        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? t("saving") : t("copyToStore")}
      </button>
    </div>
  )
}
