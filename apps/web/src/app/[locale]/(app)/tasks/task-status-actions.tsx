"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

// FSM переходов (зеркало repo): терминальные без действий.
const NEXT: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "EXPIRED", "EMPTY"],
  IN_PROGRESS: ["PHOTO_SUBMITTED", "EXPIRED", "EMPTY"],
  PHOTO_SUBMITTED: ["COMPLETED", "EXPIRED"],
  COMPLETED: [],
  EXPIRED: [],
  EMPTY: [],
}

export function TaskStatusActions({ taskId, status }: { taskId: string; status: string }) {
  const t = useTranslations("tasks.actions")
  const tConfirm = useTranslations("tasks.confirm")
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = NEXT[status] ?? []
  if (options.length === 0) return null

  async function transition(toStatus: string) {
    if (["COMPLETED", "EXPIRED", "EMPTY"].includes(toStatus) && !window.confirm(tConfirm(toStatus as never))) {
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedStatus: status, toStatus }),
      })
      if (!res.ok && res.status !== 409) throw new Error(String(res.status))
      router.refresh()
    } catch {
      setError(t("actionFailed"))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {options.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => transition(to)}
            disabled={pending}
            className="min-h-9 rounded border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            {t(to as never)}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
