"use client"

// Редактор планограмм, срез 1 (docs/16): click-to-place, физическая
// валидация на сервере (core math), optimistic lock через revision.
// Каждая мутация — API-вызов; при 422 показываем физическую причину,
// при 409 перезагружаем draft.

import { useMemo, useState } from "react"
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

interface GoldenReferencePhoto {
  id: string
  imageUrl: string
  status: string
  createdAt: string
}

interface GoldenPhotoCandidate {
  id: string
  imageUrl: string
  takenAt: string
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
  publishOptions,
  goldenReferences,
  goldenPhotoCandidates,
}: {
  planogram: { id: string; name: string }
  version: { id: string; versionNumber: number; state: string; revision: string }
  equipment: EquipmentGeometryMm & { name: string }
  initialPlacements: EditorPlacement[]
  publishOptions: PublishTargetOption
  goldenReferences: GoldenReferencePhoto[]
  goldenPhotoCandidates: GoldenPhotoCandidate[]
}) {
  const t = useTranslations("planograms.editor")
  const tState = useTranslations("planograms.state")
  const tPub = useTranslations("planograms.publish")
  const locale = useLocale()
  const router = useRouter()

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
  const [selectedGoldenPhotoId, setSelectedGoldenPhotoId] = useState(goldenPhotoCandidates[0]?.id ?? "")
  const readOnly = version.state !== "DRAFT"

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null

  const base = `/api/v1/planograms/${planogram.id}/versions/${version.id}/placements`

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
      setReferences((prev) => [
        {
          id: body.id as string,
          imageUrl: body.imageUrl as string,
          status: body.status as string,
          createdAt: body.createdAt as string,
        },
        ...prev,
      ])
    }
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
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="rounded-md border border-neutral-300 bg-neutral-50"
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
              const shelf = equipment.shelves.find((s) => s.id === p.shelfId)
              if (!shelf) return null
              const wPx = p.widthMm * p.facingsX * k
              const hPx = p.heightMm * p.facingsY * k
              const x = p.xMm * k
              const y = H - (shelf.yMm + shelf.thicknessMm + p.heightMm * p.facingsY) * k
              const isSel = p.id === selectedPlacementId
              return (
                <g
                  key={p.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedPlacementId(p.id)
                    setSelectedShelfId(p.shelfId)
                  }}
                  className="cursor-pointer"
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
                    stroke={isSel ? "#0f172a" : "white"}
                    strokeWidth={isSel ? 2 : 0.8}
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
              <div className="mb-3 grid grid-cols-2 gap-2">
                {references.slice(0, 4).map((ref) => (
                  <div key={ref.id} className="overflow-hidden rounded-md border border-neutral-200">
                    <img src={`/api/media/${ref.imageUrl}`} alt="" className="h-24 w-full object-cover" />
                    <div className="px-2 py-1 text-xs text-neutral-500">{ref.status}</div>
                  </div>
                ))}
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
