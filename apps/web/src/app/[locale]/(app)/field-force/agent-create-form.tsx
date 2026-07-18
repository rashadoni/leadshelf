"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

export function AgentCreateForm({
  users,
  teams,
}: {
  users: Array<{ id: string; name: string; employeeCode: string | null }>
  teams: Array<{ id: string; name: string }>
}) {
  const t = useTranslations("fieldForce")
  const tc = useTranslations("common")
  const router = useRouter()
  const [userId, setUserId] = useState(users[0]?.id ?? "")
  const [teamId, setTeamId] = useState("")
  const [phone, setPhone] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    if (!userId) return
    const res = await fetchApiResponse("/api/v1/field-force/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, teamId: teamId || null, phone: phone || null }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMessage(formatResponseError(
        res,
        String(body.error ?? res.status),
        (value) => tc("supportCode", { value }),
      ))
      return
    }
    setMessage(null)
    router.refresh()
  }

  if (users.length === 0) {
    return <p className="text-sm text-neutral-500">{t("noUserCandidates")}</p>
  }

  return (
    <div className="grid gap-2 md:grid-cols-[1fr_1fr_160px_auto]">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
            {user.employeeCode ? ` (${user.employeeCode})` : ""}
          </option>
        ))}
      </select>
      <select
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      >
        <option value="">{t("noTeam")}</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t("phone")}
        className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        onClick={submit}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        {t("addAgent")}
      </button>
      {message && <div className="text-xs text-red-600 md:col-span-4">{message}</div>}
    </div>
  )
}
