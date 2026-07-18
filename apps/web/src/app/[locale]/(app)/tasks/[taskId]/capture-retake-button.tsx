"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { formatApiError, requireApiResponse } from "@/client/api-error"

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
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestRetake() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/capture-retake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, stepKind }),
      })
      requireApiResponse(res, [409])
      router.refresh()
    } catch (error) {
      setError(formatApiError(error, t("detail.decisionFailed"), (value) => tc("supportCode", { value })))
    } finally {
      setPending(false)
    }
  }

  if (requested) {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
        {t("detail.retakeRequested")}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={requestRetake}
        disabled={pending}
        className="min-h-9 rounded border border-neutral-300 px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? t("detail.decisionSaving") : t("detail.requestRetake")}
      </button>
      {error ? <span role="alert" className="text-xs text-red-700">{error}</span> : null}
    </span>
  )
}
