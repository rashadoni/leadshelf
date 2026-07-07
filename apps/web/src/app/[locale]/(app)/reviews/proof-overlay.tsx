"use client"

import { useState } from "react"

export interface ProofOverlayBox {
  id: string
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
  sku: string | null
  confidence: number
  status: "match" | "issue" | "uncertain"
}

const BOX_STYLE: Record<ProofOverlayBox["status"], string> = {
  match: "border-emerald-400 bg-emerald-400/10",
  issue: "border-red-500 bg-red-500/10",
  uncertain: "border-amber-400 bg-amber-400/10",
}

const DOT_STYLE: Record<ProofOverlayBox["status"], string> = {
  match: "bg-emerald-500",
  issue: "bg-red-500",
  uncertain: "bg-amber-500",
}

// Визуальная проверка полки (docs/27 P0 #1): рамки находок vision поверх
// реального снимка. Клик по рамке — деталь. Данные — detections c bbox в %.
export function ProofOverlay({
  src,
  boxes,
  statusLabels,
  emptyLabel,
}: {
  src: string
  boxes: ProofOverlayBox[]
  statusLabels: Record<ProofOverlayBox["status"], string>
  emptyLabel: string
}) {
  const [active, setActive] = useState<string | null>(null)

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-900">
        <img src={src} alt="" className="block w-full object-contain" />
        {boxes.map((box) => {
          const isActive = active === box.id
          return (
            <button
              key={box.id}
              type="button"
              onClick={() => setActive(isActive ? null : box.id)}
              style={{
                left: `${box.xPct}%`,
                top: `${box.yPct}%`,
                width: `${box.widthPct}%`,
                height: `${box.heightPct}%`,
              }}
              className={`absolute rounded-sm border-2 transition ${BOX_STYLE[box.status]} ${
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
        {(["match", "issue", "uncertain"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT_STYLE[s]}`} />
            {statusLabels[s]}
          </span>
        ))}
      </div>
      {active ? (
        (() => {
          const box = boxes.find((b) => b.id === active)
          if (!box) return null
          return (
            <div className="mt-2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs">
              <span className={`mr-2 inline-flex items-center gap-1 font-medium`}>
                <span className={`h-2.5 w-2.5 rounded-full ${DOT_STYLE[box.status]}`} />
                {statusLabels[box.status]}
              </span>
              <span className="text-neutral-700">{box.sku ?? emptyLabel}</span>
              <span className="ml-2 tabular-nums text-neutral-500">{Math.round(box.confidence * 100)}%</span>
            </div>
          )
        })()
      ) : null}
    </div>
  )
}
