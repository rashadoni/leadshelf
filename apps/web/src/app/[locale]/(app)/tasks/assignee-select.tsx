"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

export function AssigneeSelect({
  taskId,
  current,
  users,
}: {
  taskId: string
  current: string | null
  users: Array<{ id: string; name: string; employeeCode: string | null }>
}) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function assign(assigneeId: string) {
    setPending(true)
    setError(null)
    const response = await fetchApiResponse(`/api/v1/tasks/${taskId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: assigneeId || null }),
    })
    setPending(false)
    if (response.ok) router.refresh()
    else setError(formatResponseError(response, tc("actionFailed"), (value) => tc("supportCode", { value })))
  }

  return (
    <span className="flex min-w-0 max-w-full flex-col gap-1">
      <select
      value={current ?? ""}
      onChange={(e) => assign(e.target.value)}
      disabled={pending}
      aria-label={t("table.assignee")}
      className="min-h-9 w-full min-w-0 max-w-full rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50"
    >
      <option value="">{t("unassigned")}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.employeeCode ? ` (${u.employeeCode})` : ""}
        </option>
      ))}
      </select>
      {error ? <span role="alert" className="text-xs text-red-700">{error}</span> : null}
    </span>
  )
}
