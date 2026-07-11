"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ProofOverlay, type ProofOverlayBox } from "./proof-overlay"

interface ManualAnnotation {
  id: string
  placementId: string | null
  productId: string | null
  facings: number
  bbox: { xPct: number; yPct: number; widthPct: number; heightPct: number }
}

export interface ManualShelfEditorLabels {
  title: string
  hint: string
  add: string
  remove: string
  save: string
  saving: string
  saved: string
  failed: string
  sku: string
  placement: string
  facings: string
  x: string
  y: string
  width: string
  height: string
  unassigned: string
  overlayLabel: string
}

export function ManualShelfEditor({
  reviewId,
  photoSrc,
  imageAlt,
  initialAnnotations,
  products,
  placements,
  labels,
}: {
  reviewId: string
  photoSrc: string | null
  imageAlt: string
  initialAnnotations: ManualAnnotation[]
  products: Array<{ id: string; sku: string; name: string }>
  placements: Array<{ id: string; sku: string }>
  labels: ManualShelfEditorLabels
}) {
  const router = useRouter()
  const [rows, setRows] = useState(initialAnnotations)
  const [selectedId, setSelectedId] = useState<string | null>(initialAnnotations[0]?.id ?? null)
  const [sequence, setSequence] = useState(initialAnnotations.length + 1)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle")

  const boxes: ProofOverlayBox[] = rows.map((row) => {
    const product = products.find((item) => item.id === row.productId)
    return {
      id: row.id,
      selectionKey: row.id,
      ...row.bbox,
      sku: product?.sku ?? null,
      confidence: 1,
      status: "match",
    }
  })

  function updateRow(id: string, patch: Partial<ManualAnnotation>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setState("idle")
  }

  function updateBBox(id: string, key: keyof ManualAnnotation["bbox"], value: number) {
    setRows((current) => current.map((row) => row.id === id
      ? { ...row, bbox: { ...row.bbox, [key]: Number.isFinite(value) ? value : 0 } }
      : row))
    setState("idle")
  }

  function addRow() {
    const id = `manual-${sequence}`
    const placement = placements[0]
    const product = products.find((item) => item.sku === placement?.sku) ?? products[0]
    setSequence((value) => value + 1)
    setRows((current) => [...current, {
      id,
      placementId: placement?.id ?? null,
      productId: product?.id ?? null,
      facings: 1,
      bbox: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 },
    }])
    setSelectedId(id)
    setState("idle")
  }

  async function save() {
    setState("saving")
    try {
      const response = await fetch(`/api/v1/reviews/${reviewId}/annotations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: rows }),
      })
      if (!response.ok) throw new Error(String(response.status))
      setState("saved")
      router.refresh()
    } catch {
      setState("failed")
    }
  }

  return (
    <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-neutral-900">{labels.title}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-neutral-600">{labels.hint}</p>
        {photoSrc ? (
          <ProofOverlay
            src={photoSrc}
            boxes={boxes}
            imageAlt={imageAlt}
            emptyLabel={labels.unassigned}
            statusLabels={{ match: labels.overlayLabel }}
            showConfidence={false}
            activeSelectionKey={selectedId}
            onSelectionChange={setSelectedId}
          />
        ) : null}
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`grid gap-2 rounded-lg border bg-white p-2 md:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_90px_repeat(4,72px)_auto] ${
                selectedId === row.id ? "border-indigo-400 ring-1 ring-indigo-300" : "border-neutral-200"
              }`}
            >
              <label className="text-xs text-neutral-600">
                <span className="mb-1 block">{labels.sku}</span>
                <select
                  value={row.productId ?? ""}
                  onChange={(event) => updateRow(row.id, { productId: event.target.value || null })}
                  className="min-h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                >
                  <option value="">{labels.unassigned}</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-neutral-600">
                <span className="mb-1 block">{labels.placement}</span>
                <select
                  value={row.placementId ?? ""}
                  onChange={(event) => updateRow(row.id, { placementId: event.target.value || null })}
                  className="min-h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                >
                  <option value="">{labels.unassigned}</option>
                  {placements.map((placement) => <option key={placement.id} value={placement.id}>{placement.sku}</option>)}
                </select>
              </label>
              <NumberField label={labels.facings} value={row.facings} min={1} max={999} onChange={(value) => updateRow(row.id, { facings: Math.max(1, Math.floor(value)) })} />
              <NumberField label={labels.x} value={row.bbox.xPct} onChange={(value) => updateBBox(row.id, "xPct", value)} />
              <NumberField label={labels.y} value={row.bbox.yPct} onChange={(value) => updateBBox(row.id, "yPct", value)} />
              <NumberField label={labels.width} value={row.bbox.widthPct} min={0.1} onChange={(value) => updateBBox(row.id, "widthPct", value)} />
              <NumberField label={labels.height} value={row.bbox.heightPct} min={0.1} onChange={(value) => updateBBox(row.id, "heightPct", value)} />
              <button
                type="button"
                onClick={() => {
                  setRows((current) => current.filter((item) => item.id !== row.id))
                  setSelectedId(null)
                  setState("idle")
                }}
                className="min-h-10 self-end rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                {labels.remove}
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={addRow} className="min-h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-100">
            {labels.add}
          </button>
          <div className="flex items-center gap-3">
            {state === "saved" ? <span role="status" className="text-sm text-emerald-700">{labels.saved}</span> : null}
            {state === "failed" ? <span role="alert" className="text-sm text-red-700">{labels.failed}</span> : null}
            <button type="button" disabled={state === "saving"} onClick={save} className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
              {state === "saving" ? labels.saving : labels.save}
            </button>
          </div>
        </div>
      </div>
    </details>
  )
}

function NumberField({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange(value: number): void
}) {
  return (
    <label className="text-xs text-neutral-600">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-10 w-full rounded-md border border-neutral-300 px-2 text-sm tabular-nums text-neutral-900"
      />
    </label>
  )
}
