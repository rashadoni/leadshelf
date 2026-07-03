"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

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
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function assign(assigneeId: string) {
    setPending(true)
    await fetch(`/api/v1/tasks/${taskId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: assigneeId || null }),
    })
    setPending(false)
    router.refresh()
  }

  return (
    <select
      value={current ?? ""}
      onChange={(e) => assign(e.target.value)}
      disabled={pending}
      className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 disabled:opacity-50"
    >
      <option value="">{t("unassigned")}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.employeeCode ? ` (${u.employeeCode})` : ""}
        </option>
      ))}
    </select>
  )
}
