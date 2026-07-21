"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { formatApiError, requireApiResponse } from "@/client/api-error"

export function ProofDecisionActions({
  taskId,
  reviewId,
  stepId,
  stepKind,
  retakeRequested,
}: {
  taskId: string
  reviewId: string | null
  stepId: string | null
  stepKind: string | null
  retakeRequested: boolean
}) {
  const router = useRouter()
  const t = useTranslations("tasks.detail")
  const tReviews = useTranslations("reviews")
  const tc = useTranslations("common")
  const [pending, setPending] = useState<"accept" | "reject" | "retake" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function requireOk(request: Promise<Response>) {
    const response = await request
    requireApiResponse(response, [409])
  }

  async function decide(action: "accept" | "reject" | "retake") {
    setPending(action)
    setError(null)
    try {
      if (action === "accept") {
        await requireOk(reviewId
          ? fetch(`/api/v1/reviews/${reviewId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "APPROVED" }),
            })
          : fetch(`/api/v1/tasks/${taskId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedStatus: "PHOTO_SUBMITTED", toStatus: "COMPLETED" }),
            }))
      } else if (action === "reject" && reviewId) {
        await requireOk(fetch(`/api/v1/reviews/${reviewId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "REJECTED" }),
        }))
      } else if (action === "retake" && stepId) {
        await requireOk(fetch(`/api/v1/tasks/${taskId}/capture-retake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId, stepKind, reviewId }),
        }))
      }
      router.refresh()
    } catch (error) {
      setError(formatApiError(error, t("decisionFailed"), (value) => tc("supportCode", { value })))
    } finally {
      setPending(null)
    }
  }

  const disabled = pending !== null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => decide("accept")}
          className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending === "accept" ? t("decisionSaving") : tReviews("approve")}
        </button>
        {reviewId ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => decide("reject")}
            className="min-h-10 rounded-md border border-red-200 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {pending === "reject" ? t("decisionSaving") : tReviews("reject")}
          </button>
        ) : null}
        {stepId ? (
          retakeRequested ? (
            <span className="inline-flex min-h-10 items-center rounded-md bg-amber-100 px-4 text-sm font-medium text-amber-800">
              {t("retakeRequested")}
            </span>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => decide("retake")}
              className="min-h-10 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {pending === "retake" ? t("decisionSaving") : t("requestRetake")}
            </button>
          )
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  )
}
