"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function CaptureRetakeButton({
  taskId,
  stepId,
  stepKind,
  requested,
}: {
  taskId: string
  stepId: string
  stepKind: string | null
  requested: boolean
}) {
  const t = useTranslations("tasks")
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function requestRetake() {
    setPending(true)
    const res = await fetch(`/api/v1/tasks/${taskId}/capture-retake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, stepKind }),
    })
    setPending(false)
    if (res.ok) router.refresh()
  }

  if (requested) {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
        {t("detail.retakeRequested")}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={requestRetake}
      disabled={pending}
      className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
    >
      {t("detail.requestRetake")}
    </button>
  )
}
