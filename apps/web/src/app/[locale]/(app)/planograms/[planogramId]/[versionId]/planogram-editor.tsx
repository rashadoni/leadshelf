"use client"

// Редактор планограмм, срез 1 (docs/16): click-to-place, физическая
// валидация на сервере (core math), optimistic lock через revision.
// Каждая мутация — API-вызов; при 422 показываем физическую причину,
// при 409 перезагружаем draft.

import { useMemo, useRef, useState, type PointerEvent } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  shelfSpaceForShelf,
  shelfUsage,
  type EquipmentGeometryMm,
} from "@leadshelf/core"
import { PublishDialog, type PublishTargetOption } from "./publish-dialog"

const PlanogramThreeViewer = dynamic(
  () => import("./planogram-three-viewer").then((mod) => mod.PlanogramThreeViewer),
  { ssr: false },
)

export interface EditorProduct {
  id: string
  sku: string
  name: string
  brandName: string | null
  imageKey: string | null
}

export interface EditorPlacement {
  id: string
  shelfId: string
  xMm: number
  widthMm: number
  heightMm: number
  depthMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
  product: EditorProduct
}

interface PickerProduct {
  id: string
  sku: string
  name: string
  imageKey: string | null
  hasDimensions: boolean
  widthMm: number | null
}

interface DragState {
  placementId: string
  offsetMm: number
  xMm: number
  shelfId: string
}

interface VersionHistoryPlacement {
  productId: string
  productSku: string
  productName: string
  shelfId: string
  xMm: number
  widthMm: number
  heightMm: number
  depthMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
}

interface VersionHistoryItem {
  id: string
  versionNumber: number
  state: string
  createdAt: string
  publishedAt: string | null
  placements: VersionHistoryPlacement[]
}

interface DiffEntry {
  kind: "added" | "removed" | "moved"
  sku: string
  name: string
  from?: string
  to?: string
  currentKey?: string
}

interface GoldenReferenceSlot {
  id: string
  placementId: string | null
  productId: string | null
  productSku: string | null
  productName: string | null
  label: string | null
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

interface GoldenReferencePhoto {
  id: string
  imageUrl: string
  status: string
  createdAt: string
  slots: GoldenReferenceSlot[]
}

interface GoldenPhotoCandidate {
  id: string
  imageUrl: string
  takenAt: string
  qualityScore: number | null
  storeName: string
  userName: string
}

const PALETTE = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6", "#f97316"]
function colorFor(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

export function PlanogramEditor({
  planogram,
  version,
  equipment,
  initialPlacements,
  versionHistory,
  publishOptions,
  goldenReferences,
  goldenPhotoCandidates,
}: {
  planogram: { id: string; name: string }
  version: { id: string; versionNumber: number; state: string; revision: string }
  equipment: EquipmentGeometryMm & { name: string }
  initialPlacements: EditorPlacement[]
  versionHistory: VersionHistoryItem[]
  publishOptions: PublishTargetOption
  goldenReferences: GoldenReferencePhoto[]
  goldenPhotoCandidates: GoldenPhotoCandidate[]
}) {
  const t = useTranslations("planograms.editor")
  const tState = useTranslations("planograms.state")
  const tPub = useTranslations("planograms.publish")
  const locale = useLocale()
  const router = useRouter()
  const svgRef = useRef<SVGSVGElement | null>(null)

  const [placements, setPlacements] = useState(initialPlacements)
  const [revision, setRevision] = useState(version.revision)
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(
    equipment.shelves[0]?.id ?? null,
  )
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [pickerProducts, setPickerProducts] = useState<PickerProduct[]>([])
  const [references, setReferences] = useState(goldenReferences)
  const [activeReferenceId, setActiveReferenceId] = useState(goldenReferences[0]?.id ?? "")
  const [selectedGoldenPhotoId, setSelectedGoldenPhotoId] = useState(goldenPhotoCandidates[0]?.id ?? "")
  const [slotPlacementId, setSlotPlacementId] = useState(initialPlacements[0]?.id ?? "")
  const [slotDraft, setSlotDraft] = useState({ xPct: 5, yPct: 5, widthPct: 20, heightPct: 20 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const readOnly = version.state !== "DRAFT"

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null
  const activeReference = references.find((ref) => ref.id === activeReferenceId) ?? references[0] ?? null
  const slotPlacement = placements.find((p) => p.id === slotPlacementId) ?? placements[0] ?? null
  const currentHistory = versionHistory.find((item) => item.id === version.id) ?? null
  const previousHistory =
    versionHistory
      .filter((item) => item.versionNumber < version.versionNumber)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null

  const base = `/api/v1/planograms/${planogram.id}/versions/${version.id}/placements`
  const goldenReferenceBase = `/api/v1/planograms/${planogram.id}/versions/${version.id}/golden-reference`

  async function handleResponse(res: Response): Promise<Record<string, unknown> | null> {
    if (res.status === 409) {
      setMessage(t("conflict"))
      router.refresh()
      return null
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(`${t("rejected")}: ${body.message ?? body.error ?? res.status}`)
      return null
    }
    setMessage(null)
    return body
  }

  async function searchProducts(q: string) {
    setSearch(q)
    if (q.trim().length < 2) {
      setPickerProducts([])
      return
    }
    const res = await fetch(`/api/v1/catalog/products?q=${encodeURIComponent(q)}&limit=8`)
    if (res.ok) {
      const body = await res.json()
      setPickerProducts(body.products)
    }
  }

  async function place(product: PickerProduct) {
    if (!selectedShelfId || readOnly) return
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: revision,
        shelfId: selectedShelfId,
        productId: product.id,
        facingsX: 1,
        facingsY: 1,
        facingsZ: 1,
      }),
    })
    const body = await handleResponse(res)
    if (body) {
      setRevision(body.revision as string)
      router.refresh()
      // локально дорисуем без ожидания refresh
      setPlacements((prev) => [
        ...prev,
        {
          id: body.placementId as string,
          shelfId: selectedShelfId,
          xMm: body.xMm as number,
          widthMm: product.widthMm ?? 0,
          heightMm: 0,
          depthMm: 0,
          facingsX: 1,
          facingsY: 1,
          facingsZ: 1,
          product: {
            id: product.id,
            sku: product.sku,
            name: product.name,
            brandName: null,
            imageKey: product.imageKey,
          },
        },
      ])
      setSelectedPlacementId(body.placementId as string)
    }
  }

  async function patchPlacement(id: string, patch: Record<string, number | string>) {
    const res = await fetch(`${base}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision, ...patch }),
    })
    const body = await handleResponse(res)
    if (body) {
      setRevision(body.revision as string)
      setPlacements((prev) =>
        prev.map((p) => (p.id === id ? ({ ...p, ...patch } as EditorPlacement) : p)),
      )
    }
  }

  async function deletePlacement(id: string) {
    const res = await fetch(`${base}/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision }),
    })
    const body = await handleResponse(res)
    if (body) {
      setRevision(body.revision as string)
      setPlacements((prev) => prev.filter((p) => p.id !== id))
      setSelectedPlacementId(null)
    }
  }

  async function createGoldenReference() {
    if (!selectedGoldenPhotoId) return
    const res = await fetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/golden-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoSubmissionId: selectedGoldenPhotoId }),
    })
    const body = await handleResponse(res)
    if (body) {
      const reference = {
        id: body.id as string,
        imageUrl: body.imageUrl as string,
        status: body.status as string,
        createdAt: body.createdAt as string,
        slots: [],
      }
      setReferences((prev) => [
        reference,
        ...prev,
      ])
      setActiveReferenceId(reference.id)
    }
  }

  async function createReferenceSlot() {
    if (!activeReference || !slotPlacement) return
    const res = await fetch(`${goldenReferenceBase}/${activeReference.id}/slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placementId: slotPlacement.id,
        label: slotPlacement.product.name,
        ...slotDraft,
      }),
    })
    const body = await handleResponse(res)
    if (!body) return

    const slot: GoldenReferenceSlot = {
      id: body.id as string,
      placementId: body.placementId as string,
      productId: body.productId as string,
      productSku: body.productSku as string,
      productName: body.productName as string,
      label: body.label as string,
      xPct: body.xPct as number,
      yPct: body.yPct as number,
      widthPct: body.widthPct as number,
      heightPct: body.heightPct as number,
    }
    setReferences((prev) =>
      prev.map((ref) => (ref.id === activeReference.id ? { ...ref, slots: [...ref.slots, slot] } : ref)),
    )
  }

  async function deleteReferenceSlot(referenceId: string, slotId: string) {
    const res = await fetch(`${goldenReferenceBase}/${referenceId}/slots/${slotId}`, { method: "DELETE" })
    const body = await handleResponse(res)
    if (!body) return
    setReferences((prev) =>
      prev.map((ref) =>
        ref.id === referenceId ? { ...ref, slots: ref.slots.filter((slot) => slot.id !== slotId) } : ref,
      ),
    )
  }

  // --- SVG geometry ---
  const H = 560
  const k = H / equipment.heightMm
  const W = equipment.widthMm * k

  const shelfInfos = useMemo(
    () =>
      equipment.shelves.map((s) => {
        const space = shelfSpaceForShelf(equipment, s.id)!
        const usage = shelfUsage({
          shelf: space,
          shelfId: s.id,
          existing: placements,
        })
        return { shelf: s, space, usage }
      }),
    [equipment, placements],
  )

  const diff = useMemo(() => {
    if (!currentHistory || !previousHistory) return { entries: [] as DiffEntry[], currentMarks: new Map<string, DiffEntry["kind"]>() }

    const previous = previousHistory.placements
    const current = currentHistory.placements
    const usedPrevious = new Set<number>()
    const entries: DiffEntry[] = []
    const currentMarks = new Map<string, DiffEntry["kind"]>()

    function label(item: VersionHistoryPlacement) {
      const shelfIndex = equipment.shelves.find((shelf) => shelf.id === item.shelfId)?.shelfIndex
      return `${shelfIndex == null ? "?" : shelfIndex + 1}:${item.xMm}mm`
    }
    function exactKey(item: VersionHistoryPlacement) {
      return [
        item.productId,
        item.shelfId,
        item.xMm,
        item.facingsX,
        item.facingsY,
        item.facingsZ,
        item.widthMm,
        item.heightMm,
        item.depthMm,
      ].join(":")
    }
    for (const item of current) {
      const sameIndex = previous.findIndex((candidate, index) => !usedPrevious.has(index) && exactKey(candidate) === exactKey(item))
      if (sameIndex >= 0) {
        usedPrevious.add(sameIndex)
        continue
      }
      const movedIndex = previous.findIndex((candidate, index) => !usedPrevious.has(index) && candidate.productId === item.productId)
      if (movedIndex >= 0) {
        const old = previous[movedIndex]!
        usedPrevious.add(movedIndex)
        const entry: DiffEntry = {
          kind: "moved",
          sku: item.productSku,
          name: item.productName,
          from: label(old),
          to: label(item),
          currentKey: exactKey(item),
        }
        entries.push(entry)
        currentMarks.set(exactKey(item), "moved")
      } else {
        const entry: DiffEntry = {
          kind: "added",
          sku: item.productSku,
          name: item.productName,
          to: label(item),
          currentKey: exactKey(item),
        }
        entries.push(entry)
        currentMarks.set(exactKey(item), "added")
      }
    }
    previous.forEach((item, index) => {
      if (usedPrevious.has(index)) return
      entries.push({ kind: "removed", sku: item.productSku, name: item.productName, from: label(item) })
    })

    return { entries, currentMarks }
  }, [currentHistory, previousHistory, equipment.shelves])

  function editorPlacementDiffKey(item: EditorPlacement) {
    return [
      item.product.id,
      item.shelfId,
      item.xMm,
      item.facingsX,
      item.facingsY,
      item.facingsZ,
      item.widthMm,
      item.heightMm,
      item.depthMm,
    ].join(":")
  }

  function pointInSvg(event: PointerEvent<SVGSVGElement | SVGGElement>) {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(matrix.inverse())
  }

  function shelfIdForSvgY(y: number): string | null {
    for (const { shelf, space } of shelfInfos) {
      const shelfTop = H - (shelf.yMm + shelf.thicknessMm) * k
      const zoneTop = shelfTop - space.clearanceHeightMm * k
      if (y >= zoneTop && y <= shelfTop + Math.max(6, shelf.thicknessMm * k)) return shelf.id
    }
    return null
  }

  function snappedXMm(rawMm: number, placement: EditorPlacement): number {
    const max = Math.max(0, equipment.widthMm - placement.widthMm * placement.facingsX)
    return Math.max(0, Math.min(max, Math.round(rawMm / 10) * 10))
  }

  function startDrag(event: PointerEvent<SVGGElement>, placement: EditorPlacement) {
    if (readOnly) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointInSvg(event)
    if (!point) return
    setSelectedPlacementId(placement.id)
    setSelectedShelfId(placement.shelfId)
    setDrag({
      placementId: placement.id,
      offsetMm: point.x / k - placement.xMm,
      xMm: placement.xMm,
      shelfId: placement.shelfId,
    })
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return
    const point = pointInSvg(event)
    const placement = placements.find((p) => p.id === drag.placementId)
    if (!point || !placement) return
    const shelfId = shelfIdForSvgY(point.y) ?? drag.shelfId
    setDrag({
      ...drag,
      xMm: snappedXMm(point.x / k - drag.offsetMm, placement),
      shelfId,
    })
    setSelectedShelfId(shelfId)
  }

  async function finishDrag() {
    const state = drag
    setDrag(null)
    if (!state) return
    const placement = placements.find((p) => p.id === state.placementId)
    if (!placement) return
    if (placement.xMm === state.xMm && placement.shelfId === state.shelfId) return
    await patchPlacement(state.placementId, { xMm: state.xMm, shelfId: state.shelfId })
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{planogram.name}</h1>
        <span className="text-sm text-neutral-500">{equipment.name}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            version.state === "DRAFT" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
          }`}
        >
          v{version.versionNumber} · {tState(version.state as never)}
        </span>
        <span className="flex-1" />
        {!readOnly && placements.length > 0 && (
          <PublishDialog
            options={publishOptions}
            revision={revision}
            publishUrl={`/api/v1/planograms/${planogram.id}/versions/${version.id}/publish`}
            onPublished={(count) => {
              setMessage(tPub("success", { count }))
              router.refresh()
            }}
            onError={(m) => setMessage(m)}
          />
        )}
        {readOnly && (
          <>
            <span className="text-xs text-neutral-500">{tPub("readOnly")}</span>
            <button
              onClick={async () => {
                const res = await fetch(
                  `/api/v1/planograms/${planogram.id}/versions/${version.id}/next-draft`,
                  { method: "POST" },
                )
                if (res.ok) {
                  const body = await res.json()
                  window.location.assign(`/${locale}/planograms/${planogram.id}/${body.versionId}`)
                }
              }}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              {tPub("nextDraft")}
            </button>
          </>
        )}
      </div>

      {message && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-6">
        {/* Canvas */}
        <div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="rounded-md border border-neutral-300 bg-neutral-50"
            onPointerMove={moveDrag}
            onPointerUp={() => void finishDrag()}
            onPointerCancel={() => setDrag(null)}
          >
            {shelfInfos.map(({ shelf, space }) => {
              const yTop = H - (shelf.yMm + shelf.thicknessMm) * k
              const selected = shelf.id === selectedShelfId
              return (
                <g key={shelf.id} onClick={() => setSelectedShelfId(shelf.id)} className="cursor-pointer">
                  {/* зона просвета полки (кликабельна) */}
                  <rect
                    x={0}
                    y={yTop - space.clearanceHeightMm * k}
                    width={W}
                    height={space.clearanceHeightMm * k}
                    fill={selected ? "#fef3c7" : "transparent"}
                    opacity={selected ? 0.5 : 1}
                  />
                  <rect x={0} y={yTop} width={W} height={Math.max(2, shelf.thicknessMm * k)} fill="#78716c" />
                </g>
              )
            })}

            {placements.map((p) => {
              const dragState = drag?.placementId === p.id ? drag : null
              const shelf = equipment.shelves.find((s) => s.id === (dragState?.shelfId ?? p.shelfId))
              if (!shelf) return null
              const wPx = p.widthMm * p.facingsX * k
              const hPx = p.heightMm * p.facingsY * k
              const x = (dragState?.xMm ?? p.xMm) * k
              const y = H - (shelf.yMm + shelf.thicknessMm + p.heightMm * p.facingsY) * k
              const isSel = p.id === selectedPlacementId
              const diffKind = diff.currentMarks.get(editorPlacementDiffKey(p))
              return (
                <g
                  key={p.id}
                  onPointerDown={(e) => startDrag(e, p)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedPlacementId(p.id)
                    setSelectedShelfId(p.shelfId)
                  }}
                  className={readOnly ? "cursor-pointer" : "cursor-move"}
                  opacity={dragState ? 0.72 : 1}
                >
                  {p.product.imageKey ? (
                    <image
                      href={`/api/media/${p.product.imageKey}`}
                      x={x}
                      y={y}
                      width={wPx}
                      height={hPx}
                      preserveAspectRatio="none"
                    />
                  ) : (
                    <rect x={x} y={y} width={wPx} height={hPx} fill={colorFor(p.product.sku)} opacity={0.85} rx={1} />
                  )}
                  {/* границы фейсов */}
                  {Array.from({ length: p.facingsX - 1 }, (_, i) => (
                    <line
                      key={i}
                      x1={x + (i + 1) * p.widthMm * k}
                      y1={y}
                      x2={x + (i + 1) * p.widthMm * k}
                      y2={y + hPx}
                      stroke="white"
                      strokeWidth={0.7}
                      opacity={0.6}
                    />
                  ))}
                  <rect
                    x={x}
                    y={y}
                    width={wPx}
                    height={hPx}
                    fill="none"
                    stroke={isSel ? "#0f172a" : diffKind === "added" ? "#16a34a" : diffKind === "moved" ? "#f59e0b" : "white"}
                    strokeWidth={isSel || diffKind ? 2 : 0.8}
                  />
                  {wPx > 34 && (
                    <text x={x + 3} y={y + 10} fontSize={9} fill="white" style={{ pointerEvents: "none" }}>
                      {p.product.sku}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          <p className="mt-1 text-center text-xs text-neutral-400">
            {equipment.widthMm}×{equipment.heightMm}×{equipment.depthMm} mm
          </p>
          <PlanogramThreeViewer equipment={equipment} placements={placements} />
        </div>

          {/* Side panels */}
        <div className="min-w-72 max-w-sm flex-1 space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium">{t("versionHistory")}</h2>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {versionHistory.map((item) => (
                <a
                  key={item.id}
                  href={`/${locale}/planograms/${planogram.id}/${item.id}`}
                  className={`rounded border px-2 py-1 text-xs ${
                    item.id === version.id
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  v{item.versionNumber} · {tState(item.state as never)}
                </a>
              ))}
            </div>
            {previousHistory ? (
              <div>
                <div className="mb-2 text-xs font-medium text-neutral-500">
                  {t("diffAgainst", { version: previousHistory.versionNumber })}
                </div>
                {diff.entries.length === 0 ? (
                  <p className="text-xs text-neutral-500">{t("diffEmpty")}</p>
                ) : (
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {diff.entries.slice(0, 12).map((entry, index) => (
                      <div key={`${entry.kind}-${entry.sku}-${index}`} className="rounded-md bg-neutral-50 px-2 py-1 text-xs">
                        <span
                          className={
                            entry.kind === "added"
                              ? "font-medium text-green-700"
                              : entry.kind === "moved"
                                ? "font-medium text-amber-700"
                                : "font-medium text-red-700"
                          }
                        >
                          {t(`diff.${entry.kind}` as never)}
                        </span>{" "}
                        <span className="font-mono">{entry.sku}</span>{" "}
                        <span className="text-neutral-500">
                          {entry.from && entry.to ? `${entry.from} -> ${entry.to}` : entry.to ?? entry.from}
                        </span>
                      </div>
                    ))}
                    {diff.entries.length > 12 ? (
                      <div className="px-2 text-xs text-neutral-400">+{diff.entries.length - 12}</div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">{t("diffFirstVersion")}</p>
            )}
          </div>

          {!readOnly && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">{t("products")}</h2>
              <p className="mb-2 text-xs text-neutral-500">{t("selectShelf")}</p>
              <input
                type="search"
                value={search}
                onChange={(e) => searchProducts(e.target.value)}
                placeholder={t("searchProducts")}
                className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {pickerProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => place(p)}
                    disabled={!p.hasDimensions}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-40"
                    title={p.hasDimensions ? p.name : t("noDims")}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded text-xs font-bold text-white"
                      style={{ backgroundColor: colorFor(p.sku) }}
                    >
                      {p.imageKey ? (
                        <img src={`/api/media/${p.imageKey}`} alt="" className="h-full w-full object-cover" />
                      ) : (
                        p.name.slice(0, 1)
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {!p.hasDimensions && <span className="text-xs text-amber-600">⚠</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Shelf capacity */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            {shelfInfos
              .slice()
              .reverse()
              .map(({ shelf, space, usage }) => (
                <button
                  key={shelf.id}
                  onClick={() => setSelectedShelfId(shelf.id)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm ${
                    shelf.id === selectedShelfId ? "bg-amber-50" : "hover:bg-neutral-50"
                  }`}
                >
                  <span>
                    {t("shelf")} {shelf.shelfIndex + 1}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {t("freeWidth")}: {usage.freeWidthMm}/{space.innerWidthMm}mm
                  </span>
                </button>
              ))}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium">{t("goldenReference")}</h2>
            {references.length === 0 ? (
              <div className="mb-3 rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                {t("noGoldenReference")}
              </div>
            ) : (
              <div className="mb-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {references.slice(0, 4).map((ref) => (
                    <button
                      type="button"
                      key={ref.id}
                      onClick={() => setActiveReferenceId(ref.id)}
                      className={`overflow-hidden rounded-md border text-left ${
                        ref.id === activeReference?.id ? "border-neutral-900" : "border-neutral-200"
                      }`}
                    >
                      <img src={`/api/media/${ref.imageUrl}`} alt="" className="h-24 w-full object-cover" />
                      <div className="flex items-center justify-between px-2 py-1 text-xs text-neutral-500">
                        <span>{ref.status}</span>
                        <span>{ref.slots.length}</span>
                      </div>
                    </button>
                  ))}
                </div>
                {activeReference && (
                  <div>
                    <div className="relative overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                      <img
                        src={`/api/media/${activeReference.imageUrl}`}
                        alt=""
                        className="max-h-80 w-full object-contain"
                      />
                      {activeReference.slots.map((slot) => (
                        <div
                          key={slot.id}
                          className="absolute border-2 border-emerald-400 bg-emerald-400/15"
                          style={{
                            left: `${slot.xPct}%`,
                            top: `${slot.yPct}%`,
                            width: `${slot.widthPct}%`,
                            height: `${slot.heightPct}%`,
                          }}
                        >
                          <span className="absolute left-0 top-0 max-w-full truncate bg-emerald-500 px-1 text-[10px] font-medium text-white">
                            {slot.productSku ?? slot.label ?? t("referenceSlot")}
                          </span>
                        </div>
                      ))}
                    </div>
                    {activeReference.slots.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">{t("noReferenceSlots")}</p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {activeReference.slots.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-neutral-50 px-2 py-1 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {slot.productSku ? `${slot.productSku} · ` : ""}
                              {slot.productName ?? slot.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteReferenceSlot(activeReference.id, slot.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              {t("deleteReferenceSlot")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {goldenPhotoCandidates.length === 0 ? (
              <p className="text-xs text-neutral-500">{t("noGoldenPhotoCandidates")}</p>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedGoldenPhotoId}
                  onChange={(e) => setSelectedGoldenPhotoId(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  {goldenPhotoCandidates.map((photo) => (
                    <option key={photo.id} value={photo.id}>
                      {photo.storeName} · {photo.userName} · {new Date(photo.takenAt).toLocaleDateString()}
                      {photo.qualityScore === null ? "" : ` · ${Math.round(photo.qualityScore * 100)}%`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={createGoldenReference}
                  className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  {t("createGoldenReference")}
                </button>
              </div>
            )}
            {activeReference && placements.length > 0 && (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <h3 className="mb-2 text-xs font-medium text-neutral-600">{t("referenceSlot")}</h3>
                <div className="space-y-2">
                  <select
                    value={slotPlacement?.id ?? ""}
                    onChange={(e) => setSlotPlacementId(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {placements.map((placement) => (
                      <option key={placement.id} value={placement.id}>
                        {placement.product.sku} · {placement.product.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-4 gap-2">
                    {(["xPct", "yPct", "widthPct", "heightPct"] as const).map((field) => (
                      <label key={field} className="block text-xs">
                        <span className="text-neutral-500">{t(field)}</span>
                        <input
                          type="number"
                          min={field === "widthPct" || field === "heightPct" ? 1 : 0}
                          max={100}
                          value={slotDraft[field]}
                          onChange={(e) =>
                            setSlotDraft((prev) => ({
                              ...prev,
                              [field]: Number.parseFloat(e.target.value || "0"),
                            }))
                          }
                          className="block w-full rounded border border-neutral-300 px-2 py-1"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={createReferenceSlot}
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                  >
                    {t("addReferenceSlot")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Placement props */}
          {selectedPlacement && !readOnly && (
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-sm font-medium">{selectedPlacement.product.name}</div>
              <div className="text-xs text-neutral-500">
                {selectedPlacement.widthMm}×{selectedPlacement.heightMm}×{selectedPlacement.depthMm} mm ·{" "}
                {selectedPlacement.facingsX * selectedPlacement.facingsY * selectedPlacement.facingsZ}{" "}
                {t("placedUnits")}
              </div>
              <div className="flex flex-wrap gap-2">
                {(["facingsX", "facingsY", "facingsZ"] as const).map((f) => (
                  <label key={f} className="block text-xs">
                    <span className="text-neutral-500">{t(f)}</span>
                    <input
                      type="number"
                      min={1}
                      value={selectedPlacement[f]}
                      onChange={(e) =>
                        patchPlacement(selectedPlacement.id, { [f]: Number.parseInt(e.target.value || "1", 10) })
                      }
                      className="block w-20 rounded border border-neutral-300 px-2 py-1"
                    />
                  </label>
                ))}
                <label className="block text-xs">
                  <span className="text-neutral-500">{t("position")}</span>
                  <input
                    type="number"
                    min={0}
                    value={selectedPlacement.xMm}
                    onChange={(e) =>
                      patchPlacement(selectedPlacement.id, { xMm: Number.parseInt(e.target.value || "0", 10) })
                    }
                    className="block w-24 rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
              </div>
              <button
                onClick={() => deletePlacement(selectedPlacement.id)}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                {t("remove")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
