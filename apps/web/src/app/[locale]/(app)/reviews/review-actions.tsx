"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function ReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter()
  const t = useTranslations("reviews")

  async function setStatus(status: "APPROVED" | "REJECTED") {
    const res = await fetch(`/api/v1/reviews/${reviewId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setStatus("APPROVED")}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
      >
        {t("approve")}
      </button>
      <button
        type="button"
        onClick={() => setStatus("REJECTED")}
        className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        {t("reject")}
      </button>
    </div>
  )
}
