"use client"

import { useId, useMemo, useState } from "react"
import type {
  ShelfActionType,
  ShelfComparisonResult,
  ShelfPlacementOutcome,
} from "@leadshelf/core"
import { ProofOverlay, type ProofOverlayBox, type ProofOverlayStatus } from "./proof-overlay"

type ComparisonTab = "scheme" | "photo" | "result"
type PhotoMode = "golden" | "actual" | "overlay"
type SchemeFilter = "all" | "issues" | "uncertain"

export interface ShelfComparisonLabels {
  tabs: Record<ComparisonTab, string>
  photoModes: Record<PhotoMode, string>
  status: Record<ShelfComparisonResult["status"], string>
  outcomes: Record<ShelfPlacementOutcome, string>
  actions: Record<ShelfActionType, string>
  filters: Record<SchemeFilter, string>
  schemeHint: string
  photoHint: string
  resultHint: string
  shelf: string
  expected: string
  actual: string
  structuralScore: string
  visualConfidence: string
  missingProducts: string
  extraProducts: string
  noPhoto: string
  noGolden: string
  noActions: string
  unknownSku: string
  noFilteredPlacements: string
  overlay: {
    match: string
    issue: string
    uncertain: string
    expected: string
  }
}

const OUTCOME_TONE: Record<ShelfPlacementOutcome, string> = {
  matched: "border-emerald-300 bg-emerald-50 text-emerald-950",
  missing: "border-red-300 bg-red-50 text-red-950",
  wrong_product: "border-red-300 bg-red-50 text-red-950",
  wrong_position: "border-amber-300 bg-amber-50 text-amber-950",
  facing_mismatch: "border-amber-300 bg-amber-50 text-amber-950",
  unavailable: "border-neutral-200 bg-neutral-100 text-neutral-700",
}

const STATUS_TONE: Record<ShelfComparisonResult["status"], string> = {
  PASS: "bg-emerald-100 text-emerald-800",
  REVIEW: "bg-amber-100 text-amber-800",
  FAIL: "bg-red-100 text-red-800",
  UNAVAILABLE: "bg-neutral-200 text-neutral-700",
}

function detectionStatus(
  comparison: ShelfComparisonResult,
  placementId: string | null,
  confidence: number,
): ProofOverlayStatus {
  if (confidence < 0.5 || !placementId) return "uncertain"
  const placement = comparison.placements.find((item) => item.placementId === placementId)
  return placement?.outcome === "matched" ? "match" : "issue"
}

function formatMetric(value: number | null, suffix = "%"): string {
  return value == null ? "—" : `${Math.round(value)}${suffix}`
}

export function ShelfComparisonViewer({
  comparison,
  photoSrc,
  goldenSrc,
  expectedBoxes,
  imageAlt,
  labels,
}: {
  comparison: ShelfComparisonResult
  photoSrc: string | null
  goldenSrc: string | null
  expectedBoxes: ProofOverlayBox[]
  imageAlt: { photo: string; golden: string }
  labels: ShelfComparisonLabels
}) {
  const [activeTab, setActiveTab] = useState<ComparisonTab>("scheme")
  const tabId = useId()
  const [photoMode, setPhotoMode] = useState<PhotoMode>("overlay")
  const [schemeFilter, setSchemeFilter] = useState<SchemeFilter>("all")
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const shelves = useMemo(() => {
    const grouped = new Map<string, ShelfComparisonResult["placements"]>()
    for (const placement of comparison.placements) {
      const key = placement.shelfId ?? "unassigned"
      const rows = grouped.get(key) ?? []
      rows.push(placement)
      grouped.set(key, rows)
    }
    return [...grouped.entries()]
  }, [comparison.placements])
  const detectionBoxes = comparison.detections
    .filter((detection) => detection.bbox != null)
    .map((detection): ProofOverlayBox => ({
      id: detection.detectionId,
      selectionKey: detection.placementId,
      ...detection.bbox!,
      sku: detection.productSku ?? detection.label,
      confidence: detection.confidence,
      status: detectionStatus(comparison, detection.placementId, detection.confidence),
    }))
  const selectedPlacement = selectedPlacementId
    ? comparison.placements.find((placement) => placement.placementId === selectedPlacementId) ?? null
    : null
  const filteredShelves = shelves
    .map(([shelfId, placements]) => [
      shelfId,
      placements.filter((placement) => {
        if (schemeFilter === "issues") return placement.outcome !== "matched" && placement.outcome !== "unavailable"
        if (schemeFilter === "uncertain") return placement.outcome === "unavailable" || placement.confidence == null || placement.confidence < 0.5
        return true
      }),
    ] as const)
    .filter(([, placements]) => placements.length > 0)

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white" aria-label={labels.tabs.result}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label={labels.tabs.result}>
          {(["scheme", "photo", "result"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${tabId}-${tab}`}
              aria-controls={`${tabId}-${tab}-panel`}
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-indigo-600 text-white"
                  : "text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {labels.tabs[tab]}
            </button>
          ))}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[comparison.status]}`}>
          {labels.status[comparison.status]}
        </span>
      </div>

      {activeTab === "scheme" ? (
        <div className="p-3" role="tabpanel" id={`${tabId}-scheme-panel`} aria-labelledby={`${tabId}-scheme`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-3xl text-sm text-neutral-600">{labels.schemeHint}</p>
            <div className="flex rounded-lg bg-neutral-100 p-1">
              {(["all", "issues", "uncertain"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={schemeFilter === filter}
                  onClick={() => setSchemeFilter(filter)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${schemeFilter === filter ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600"}`}
                >
                  {labels.filters[filter]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {filteredShelves.map(([shelfId, placements], shelfIndex) => (
              <div key={shelfId} className="grid gap-2 sm:grid-cols-[84px_1fr] sm:items-stretch">
                <div className="flex items-center text-xs font-medium text-neutral-500">
                  {labels.shelf} {shelfIndex + 1}
                </div>
                <div className="flex min-h-20 flex-wrap items-stretch gap-2 border-b-4 border-neutral-300 pb-2">
                  {placements.map((placement) => {
                    const selected = selectedPlacementId === placement.placementId
                    return (
                      <button
                        key={placement.placementId}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedPlacementId(selected ? null : placement.placementId)}
                        className={`min-w-36 flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${OUTCOME_TONE[placement.outcome]} ${
                          selected ? "ring-2 ring-indigo-500 ring-offset-1" : "hover:brightness-95"
                        }`}
                      >
                        <span className="block truncate text-sm font-semibold">
                          {placement.productSku ?? placement.productName}
                        </span>
                        <span className="mt-1 block text-xs">
                          {labels.expected}: {placement.expectedFacings} · {labels.actual}: {placement.actualFacings ?? "—"}
                        </span>
                        <span className="mt-1 block text-xs font-medium">{labels.outcomes[placement.outcome]}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {filteredShelves.length === 0 ? (
              <div className="rounded-lg bg-neutral-100 px-3 py-6 text-center text-sm text-neutral-600">{labels.noFilteredPlacements}</div>
            ) : null}
          </div>
          {selectedPlacement ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 pt-3 text-sm">
              <span className="font-semibold text-neutral-900">
                {selectedPlacement.productSku ?? selectedPlacement.productName}
              </span>
              <span className="text-neutral-600">{labels.outcomes[selectedPlacement.outcome]}</span>
              <span className="tabular-nums text-neutral-600">
                {labels.expected}: {selectedPlacement.expectedFacings} · {labels.actual}: {selectedPlacement.actualFacings ?? "—"}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "photo" ? (
        <div className="p-3" role="tabpanel" id={`${tabId}-photo-panel`} aria-labelledby={`${tabId}-photo`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-2xl text-sm text-neutral-600">{labels.photoHint}</p>
            <div className="flex rounded-lg bg-neutral-100 p-1" aria-label={labels.tabs.photo}>
              {(["golden", "actual", "overlay"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={(mode === "golden" && !goldenSrc) || (mode !== "golden" && !photoSrc)}
                  aria-pressed={photoMode === mode}
                  onClick={() => setPhotoMode(mode)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    photoMode === mode ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600 hover:text-neutral-950"
                  }`}
                >
                  {labels.photoModes[mode]}
                </button>
              ))}
            </div>
          </div>
          {photoMode === "golden" ? (
            goldenSrc ? (
              <ProofOverlay
                src={goldenSrc}
                boxes={expectedBoxes}
                imageAlt={imageAlt.golden}
                statusLabels={{ expected: labels.overlay.expected }}
                emptyLabel={labels.unknownSku}
                showConfidence={false}
                activeSelectionKey={selectedPlacementId}
                onSelectionChange={setSelectedPlacementId}
              />
            ) : (
              <div className="rounded-lg bg-neutral-100 px-4 py-10 text-center text-sm text-neutral-600">{labels.noGolden}</div>
            )
          ) : photoSrc ? (
            photoMode === "actual" ? (
              <div className="overflow-hidden rounded-lg bg-neutral-950">
                <img src={photoSrc} alt={imageAlt.photo} className="block w-full object-contain" />
              </div>
            ) : (
              <ProofOverlay
                src={photoSrc}
                boxes={detectionBoxes}
                imageAlt={imageAlt.photo}
                statusLabels={labels.overlay}
                emptyLabel={labels.unknownSku}
                activeSelectionKey={selectedPlacementId}
                onSelectionChange={setSelectedPlacementId}
              />
            )
          ) : (
            <div className="rounded-lg bg-neutral-100 px-4 py-10 text-center text-sm text-neutral-600">{labels.noPhoto}</div>
          )}
        </div>
      ) : null}

      {activeTab === "result" ? (
        <div className="p-3" role="tabpanel" id={`${tabId}-result-panel`} aria-labelledby={`${tabId}-result`}>
          <p className="mb-3 max-w-3xl text-sm text-neutral-600">{labels.resultHint}</p>
          <dl className="grid gap-px overflow-hidden rounded-lg bg-neutral-200 sm:grid-cols-4">
            {[
              [labels.structuralScore, formatMetric(comparison.structuralScore)],
              [labels.visualConfidence, formatMetric(comparison.visualConfidence == null ? null : comparison.visualConfidence * 100)],
              [labels.missingProducts, String(comparison.metrics.oos.length)],
              [labels.extraProducts, String(comparison.extras.length)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-3 py-2">
                <dt className="text-xs text-neutral-600">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-neutral-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            {comparison.actions.length === 0 ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{labels.noActions}</div>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
                {comparison.actions.map((action, index) => (
                  <li key={`${action.type}-${action.placementId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium text-neutral-900">{labels.actions[action.type]}</span>
                    <span className="tabular-nums text-neutral-600">
                      {action.productSku ?? labels.unknownSku}
                      {action.amount == null ? "" : ` · ${action.amount}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
