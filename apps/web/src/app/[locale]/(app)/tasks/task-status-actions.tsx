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
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const options = NEXT[status] ?? []
  if (options.length === 0) return null

  async function transition(toStatus: string) {
    setPending(true)
    const res = await fetch(`/api/v1/tasks/${taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedStatus: status, toStatus }),
    })
    setPending(false)
    if (res.ok || res.status === 409) router.refresh()
  }

  return (
    <div className="flex gap-1">
      {options.map((to) => (
        <button
          key={to}
          onClick={() => transition(to)}
          disabled={pending}
          className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          {t(to as never)}
        </button>
      ))}
    </div>
  )
}
