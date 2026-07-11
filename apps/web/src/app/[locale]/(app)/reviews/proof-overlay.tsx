"use client"

import { useState } from "react"

export type ProofOverlayStatus = "match" | "issue" | "uncertain" | "expected"

export interface ProofOverlayBox {
  id: string
  selectionKey?: string | null
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
  sku: string | null
  confidence: number
  status: ProofOverlayStatus
}

const BOX_STYLE: Record<ProofOverlayStatus, string> = {
  match: "border-emerald-400 bg-emerald-400/10",
  issue: "border-red-500 bg-red-500/10",
  uncertain: "border-amber-400 bg-amber-400/10",
  expected: "border-sky-400 border-dashed bg-sky-400/5",
}

const DOT_STYLE: Record<ProofOverlayStatus, string> = {
  match: "bg-emerald-500",
  issue: "bg-red-500",
  uncertain: "bg-amber-500",
  expected: "bg-sky-500",
}

// Визуальная проверка полки (docs/27 P0 #1): рамки находок vision поверх
// реального снимка. Клик по рамке — деталь. Данные — detections c bbox в %.
export function ProofOverlay({
  src,
  boxes,
  statusLabels,
  emptyLabel,
  imageAlt,
  showConfidence = true,
  activeSelectionKey,
  onSelectionChange,
}: {
  src: string
  boxes: ProofOverlayBox[]
  statusLabels: Partial<Record<ProofOverlayStatus, string>>
  emptyLabel: string
  imageAlt: string
  showConfidence?: boolean
  activeSelectionKey?: string | null
  onSelectionChange?: (selectionKey: string | null) => void
}) {
  const [internalActive, setInternalActive] = useState<string | null>(null)
  const controlled = activeSelectionKey !== undefined
  const active = controlled ? activeSelectionKey : internalActive
  const setActive = (selectionKey: string | null) => {
    if (!controlled) setInternalActive(selectionKey)
    onSelectionChange?.(selectionKey)
  }
  const label = (status: ProofOverlayStatus) => statusLabels[status] ?? status
  const legendStatuses = Array.from(new Set(boxes.map((b) => b.status)))

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-900">
        <img src={src} alt={imageAlt} className="block w-full object-contain" />
        {boxes.map((box) => {
          const selectionKey = box.selectionKey ?? box.id
          const isActive = active === selectionKey
          return (
            <button
              key={box.id}
              type="button"
              aria-label={`${label(box.status)} · ${box.sku ?? emptyLabel}`}
              aria-pressed={isActive}
              onClick={() => setActive(isActive ? null : selectionKey)}
              style={{
                left: `${box.xPct}%`,
                top: `${box.yPct}%`,
                width: `${box.widthPct}%`,
                height: `${box.heightPct}%`,
              }}
              className={`absolute rounded-sm border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${BOX_STYLE[box.status]} ${
                isActive ? "ring-2 ring-white" : "hover:brightness-125"
              }`}
            >
              <span
                className={`absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full border border-white ${DOT_STYLE[box.status]}`}
              />
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
        {legendStatuses.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT_STYLE[s]}`} />
            {label(s)}
          </span>
        ))}
      </div>
      {active ? (
        (() => {
          const box = boxes.find((b) => (b.selectionKey ?? b.id) === active)
          if (!box) return null
          return (
            <div className="mt-2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs">
              <span className={`mr-2 inline-flex items-center gap-1 font-medium`}>
                <span className={`h-2.5 w-2.5 rounded-full ${DOT_STYLE[box.status]}`} />
                {label(box.status)}
              </span>
              <span className="text-neutral-700">{box.sku ?? emptyLabel}</span>
              {showConfidence ? (
                <span className="ml-2 tabular-nums text-neutral-500">{Math.round(box.confidence * 100)}%</span>
              ) : null}
            </div>
          )
        })()
      ) : null}
    </div>
  )
}
