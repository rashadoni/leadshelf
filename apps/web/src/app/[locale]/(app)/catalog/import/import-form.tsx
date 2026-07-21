"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatApiError, requireApiResponse } from "@/client/api-error"

interface Summary {
  batchId: string
  totalRows: number
  errorRows: number
  importedRows: number
  status: string
  reconciliation?: {
    status: "MATCH" | "MISMATCH"
    sourceRows: number
    importedRows: number
    errorRows: number
    sourceChecksum: string
    mismatches: string[]
  } | null
}

interface ImportError {
  id: string
  rowNumber: number | null
  field: string | null
  reason: string
  severity: "error" | "warning"
  suggestedFix: string | null
}

const ENTITIES = ["products", "prices", "stock", "sales", "assortment"] as const

const TERMINAL_IMPORT_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"])

async function waitForQueuedImport(batchId: string): Promise<Summary> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetchApiResponse(`/api/v1/catalog/imports/${batchId}`, { cache: "no-store" })
    requireApiResponse(response)
    const body = await response.json()
    if (TERMINAL_IMPORT_STATUSES.has(body.status)) {
      return {
        batchId,
        totalRows: body.totalRows,
        errorRows: body.errorRows,
        importedRows: body.reconciliation?.importedRows
          ?? Math.max(0, body.totalRows - body.errorRows),
        status: body.status,
        reconciliation: body.reconciliation ?? null,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error("import_status_timeout")
}

export function ImportForm() {
  const t = useTranslations("catalog.import")
  const tc = useTranslations("common")
  const [pending, setPending] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [errors, setErrors] = useState<ImportError[]>([])
  const [failMessage, setFailMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setSummary(null)
    setErrors([])
    setFailMessage(null)

    try {
      const form = new FormData(e.currentTarget)
      const res = await fetchApiResponse("/api/v1/catalog/imports", { method: "POST", body: form })
      requireApiResponse(res)
      const initial = await res.json()
      const s: Summary = initial.queued
        ? await waitForQueuedImport(initial.batchId)
        : initial
      setSummary(s)
      const errRes = await fetchApiResponse(`/api/v1/catalog/imports/${s.batchId}/errors?limit=100`)
      requireApiResponse(errRes)
      const body = await errRes.json()
      setErrors(body.errors)
    } catch (error) {
      setFailMessage(formatApiError(
        error,
        tc("actionFailed"),
        (value) => tc("supportCode", { value }),
      ))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6"
      >
        <p className="text-sm text-neutral-500">{t("hint")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-600">{t("entityType")}</span>
            <select
              name="entityType"
              className="block rounded-md border border-neutral-300 px-3 py-1.5"
            >
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {t(`entities.${e}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-neutral-600">{t("encoding")}</span>
            <select
              name="encoding"
              className="block rounded-md border border-neutral-300 px-3 py-1.5"
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1251">Windows-1251 (1C)</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-neutral-600">{t("file")}</span>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="block text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? t("running") : t("submit")}
        </button>
        {failMessage && <p className="text-sm text-red-600">{failMessage}</p>}
      </form>

      {summary && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-3 font-medium">{t("resultTitle")}</h2>
          <div className="flex gap-6 text-sm">
            <span>
              {t("totalRows")}: <b>{summary.totalRows}</b>
            </span>
            <span className="text-green-700">
              {t("importedRows")}: <b>{summary.importedRows}</b>
            </span>
            <span className={summary.errorRows > 0 ? "text-red-600" : "text-neutral-500"}>
              {t("errorRows")}: <b>{summary.errorRows}</b>
            </span>
          </div>

          {summary.reconciliation && (
            <div className={`mt-4 rounded-lg border p-3 text-sm ${
              summary.reconciliation.status === "MATCH"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}>
              <div className="font-medium">
                {t("reconciliationStatus")}: {t(summary.reconciliation.status === "MATCH"
                  ? "reconciliationMatch"
                  : "reconciliationMismatch")}
              </div>
              <div className="mt-1 text-xs">
                {t("checksum")}: <code title={summary.reconciliation.sourceChecksum}>
                  {summary.reconciliation.sourceChecksum.slice(0, 16)}…
                </code>
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">{t("errorsTitle")}</h3>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-neutral-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-neutral-50">
                    <tr className="text-left text-neutral-500">
                      <th className="px-2 py-1.5">{t("row")}</th>
                      <th className="px-2 py-1.5">{t("field")}</th>
                      <th className="px-2 py-1.5">{t("reason")}</th>
                      <th className="px-2 py-1.5">{t("fix")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((err) => (
                      <tr key={err.id} className="border-t border-neutral-100">
                        <td className="px-2 py-1.5">{err.rowNumber}</td>
                        <td className="px-2 py-1.5 font-mono">{err.field}</td>
                        <td
                          className={`px-2 py-1.5 ${
                            err.severity === "error" ? "text-red-700" : "text-amber-700"
                          }`}
                        >
                          {err.reason}
                        </td>
                        <td className="px-2 py-1.5 text-neutral-500">{err.suggestedFix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
