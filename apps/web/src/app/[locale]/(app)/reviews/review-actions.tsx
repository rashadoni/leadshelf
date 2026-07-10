"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function ReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter()
  const t = useTranslations("reviews")
  const [pending, setPending] = useState<"APPROVED" | "REJECTED" | null>(null)
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
      if (!res.ok && res.status !== 409) throw new Error(String(res.status))
      router.refresh()
    } catch {
      setError(t("actionFailed"))
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
