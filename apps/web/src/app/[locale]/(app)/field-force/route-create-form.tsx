"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function RouteCreateForm({
  agents,
  stores,
}: {
  agents: Array<{ id: string; name: string }>
  stores: Array<{ id: string; name: string; code: string | null }>
}) {
  const t = useTranslations("fieldForce")
  const router = useRouter()
  const [name, setName] = useState("")
  const [agentId, setAgentId] = useState("")
  const [storeIds, setStoreIds] = useState<string[]>(stores[0]?.id ? [stores[0].id] : [])
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    if (!name.trim() || storeIds.length === 0) return
    const res = await fetch("/api/v1/field-force/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, agentId: agentId || null, storeIds }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMessage(String(body.error ?? res.status))
      return
    }
    setName("")
    setMessage(null)
    router.refresh()
  }

  if (stores.length === 0) {
    return <p className="text-sm text-neutral-500">{t("noStores")}</p>
  }

  return (
    <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("routeName")}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      >
        <option value="">{t("unassigned")}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select
        multiple
        value={storeIds}
        onChange={(e) => setStoreIds(Array.from(e.currentTarget.selectedOptions, (option) => option.value))}
        className="min-h-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
            {store.code ? ` (${store.code})` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        className="h-9 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        {t("createRoute")}
      </button>
      {message && <div className="text-xs text-red-600 lg:col-span-4">{message}</div>}
    </div>
  )
}
