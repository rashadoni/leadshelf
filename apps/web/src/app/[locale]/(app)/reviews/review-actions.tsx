"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { formatApiError, requireApiResponse } from "@/client/api-error"

export function ReviewActions({
  reviewId,
  taskId,
  captureStepId,
  captureStepKind,
}: {
  reviewId: string
  taskId: string | null
  captureStepId: string | null
  captureStepKind: string | null
}) {
  const router = useRouter()
  const t = useTranslations("reviews")
  const tc = useTranslations("common")
  const [pending, setPending] = useState<"APPROVED" | "REJECTED" | "RETAKE" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(status: "APPROVED" | "REJECTED") {
    setPending(status)
    setError(null)
    try {
      const res = await fetch(`/api/v1/reviews/${reviewId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      requireApiResponse(res, [409])
      router.refresh()
    } catch (error) {
      setError(formatApiError(error, t("actionFailed"), (value) => tc("supportCode", { value })))
    } finally {
      setPending(null)
    }
  }

  async function requestRetake() {
    if (!taskId || !captureStepId) return
    setPending("RETAKE")
    setError(null)
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/capture-retake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: captureStepId, stepKind: captureStepKind, reviewId }),
      })
      requireApiResponse(res)
      router.refresh()
    } catch (error) {
      setError(formatApiError(error, t("actionFailed"), (value) => tc("supportCode", { value })))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => setStatus("APPROVED")}
          className="min-h-10 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending === "APPROVED" ? t("saving") : t("approve")}
        </button>
        {taskId && captureStepId ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={requestRetake}
            className="min-h-10 rounded-md border border-amber-300 px-3 text-xs font-medium text-amber-800 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {pending === "RETAKE" ? t("saving") : t("requestRetake")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => setStatus("REJECTED")}
          className="min-h-10 rounded-md border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending === "REJECTED" ? t("saving") : t("reject")}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  )
}
