"use client"

// Редактор планограмм, срез 1 (docs/16): click-to-place, физическая
// валидация на сервере (core math), optimistic lock через revision.
// Каждая мутация — API-вызов; при 422 показываем физическую причину,
// при 409 перезагружаем draft.

import { useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  orientedProductSizeMm,
  placementWidthMm,
  shelfSpaceForShelf,
  shelfUsage,
  type EquipmentGeometryMm,
  type PlacementStackMode,
} from "@leadshelf/core"
import { PublishDialog, type PublishTargetOption } from "./publish-dialog"

const PlanogramThreeViewer = dynamic(
  () => import("./planogram-three-viewer").then((mod) => mod.PlanogramThreeViewer),
  { ssr: false },
)

export interface EditorProduct {
  id: string
  sku: string
  barcode: string | null
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
  rotationX: number
  rotationY: number
  rotationZ: number
  stackMode: PlacementStackMode
  compressionX?: number
  product: EditorProduct
}

interface PickerProduct {
  id: string
  sku: string
  barcode: string | null
  name: string
  imageKey: string | null
  hasDimensions: boolean
  widthMm: number | null
  heightMm: number | null
  depthMm: number | null
}

interface DragState {
  placementId: string
  offsetMm: number
  xMm: number
  shelfId: string
}

interface ReferenceSlotDraft {
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

interface ReferenceSlotDrag {
  slotId: string
  mode: "move" | "resize"
  offsetXPct: number
  offsetYPct: number
  draft: ReferenceSlotDraft
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
  rotationX: number
  rotationY: number
  rotationZ: number
  stackMode: PlacementStackMode
  compressionX?: number
}

interface VersionHistoryItem {
  id: string
  versionNumber: number
  state: string
  createdAt: string
  publishedAt: string | null
  placements: VersionHistoryPlacement[]
}

interface EditorZone {
  id: string
  name: string
  color: string | null
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

interface AutoPlacementOptions {
  categories: Array<{ id: string; name: string }>
  brands: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
}

interface PlacementMetric {
  productId: string
  abcClass: "A" | "B" | "C"
  turnoverPerDay: number
  profitPerDay: number
  stockQty: number | null
  stockDays: number | null
  shelfShare: number
  currentPrice: number | null
  currency: string | null
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

interface AutoPreviewPlacement {
  productId: string
  sku: string
  name: string
  shelfId: string
  xMm: number
  facingsX: number
  compressionX?: number
  reason?: string
}

interface AutoPreviewState {
  placements: AutoPreviewPlacement[]
  rejectedCount: number
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
  placementMetrics,
  initialZones,
  versionHistory,
  autoPlacementOptions,
  publishOptions,
  goldenReferences,
  goldenPhotoCandidates,
}: {
  planogram: { id: string; name: string }
  version: { id: string; versionNumber: number; state: string; revision: string }
  equipment: EquipmentGeometryMm & { name: string }
  initialPlacements: EditorPlacement[]
  placementMetrics: PlacementMetric[]
  initialZones: EditorZone[]
  versionHistory: VersionHistoryItem[]
  autoPlacementOptions: AutoPlacementOptions
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
  const referenceImageRef = useRef<HTMLDivElement | null>(null)
  const referenceSlotDragRef = useRef<ReferenceSlotDrag | null>(null)

  const [placements, setPlacements] = useState(initialPlacements)
  const [zones, setZones] = useState(initialZones)
  const [revision, setRevision] = useState(version.revision)
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(
    equipment.shelves[0]?.id ?? null,
  )
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [pickerProducts, setPickerProducts] = useState<PickerProduct[]>([])
  const [selectedPickerProduct, setSelectedPickerProduct] = useState<PickerProduct | null>(null)
  const [draggingProductId, setDraggingProductId] = useState<string | null>(null)
  const [references, setReferences] = useState(goldenReferences)
  const [activeReferenceId, setActiveReferenceId] = useState(goldenReferences[0]?.id ?? "")
  const [selectedGoldenPhotoId, setSelectedGoldenPhotoId] = useState(goldenPhotoCandidates[0]?.id ?? "")
  const [slotPlacementId, setSlotPlacementId] = useState(initialPlacements[0]?.id ?? "")
  const [slotDraft, setSlotDraft] = useState<ReferenceSlotDraft>({ xPct: 5, yPct: 5, widthPct: 20, heightPct: 20 })
  const [selectedReferenceSlotId, setSelectedReferenceSlotId] = useState<string | null>(null)
  const [referenceZoom, setReferenceZoom] = useState(100)
  const [referenceStepPct, setReferenceStepPct] = useState(0.5)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [referenceSlotDrag, setReferenceSlotDrag] = useState<ReferenceSlotDrag | null>(null)
  const [zoneDraft, setZoneDraft] = useState({
    name: "",
    color: "#f59e0b",
    xMm: 0,
    yMm: 0,
    widthMm: Math.min(1000, equipment.widthMm),
    heightMm: Math.min(600, equipment.heightMm),
  })
  const [autoRule, setAutoRule] = useState({
    zoneId: initialZones[0]?.id ?? "",
    categoryId: "",
    brandId: "",
    supplierId: "",
    sortBy: "turnover",
    facingsBy: "quantity",
    excludeSkus: "",
    maxBrandSharePct: 60,
    autoCompressSoftPacks: true,
    limit: 20,
  })
  const [autoLog, setAutoLog] = useState<string | null>(null)
  const [autoPreview, setAutoPreview] = useState<AutoPreviewState | null>(null)
  const [lastAutoFillIds, setLastAutoFillIds] = useState<string[]>([])
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const readOnly = version.state !== "DRAFT"
  const isBusy = pendingAction !== null

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null
  const selectedEffectiveSize = selectedPlacement ? orientedProductSizeMm(selectedPlacement) : null
  const metricsByProductId = useMemo(
    () => new Map(placementMetrics.map((metric) => [metric.productId, metric])),
    [placementMetrics],
  )
  const activeReference = references.find((ref) => ref.id === activeReferenceId) ?? references[0] ?? null
  const slotPlacement = placements.find((p) => p.id === slotPlacementId) ?? placements[0] ?? null
  const selectedReferenceSlot =
    activeReference?.slots.find((slot) => slot.id === selectedReferenceSlotId) ?? null
  const activeAutoZone = zones.find((zone) => zone.id === autoRule.zoneId) ?? null
  const referenceCoveredPlacementIds = new Set(
    activeReference?.slots.map((slot) => slot.placementId).filter((id): id is string => Boolean(id)) ?? [],
  )
  const referenceMissingPlacements = placements.filter((placement) => !referenceCoveredPlacementIds.has(placement.id))
  const currentHistory = versionHistory.find((item) => item.id === version.id) ?? null
  const previousHistory =
    versionHistory
      .filter((item) => item.versionNumber < version.versionNumber)
      .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null

  const base = `/api/v1/planograms/${planogram.id}/versions/${version.id}/placements`
  const goldenReferenceBase = `/api/v1/planograms/${planogram.id}/versions/${version.id}/golden-reference`

  function updateAutoRule(patch: Partial<typeof autoRule>) {
    setAutoRule((prev) => ({ ...prev, ...patch }))
    setAutoPreview(null)
    setAutoLog(null)
  }

  async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const first = await fetch(input, init)
    if (first.status !== 401) return first

    const refreshed = await fetch("/api/auth/refresh", { method: "POST" })
    if (!refreshed.ok) return first
    return fetch(input, init)
  }

  async function handleResponse(res: Response): Promise<Record<string, unknown> | null> {
    if (res.status === 401) {
      setMessage(t("sessionExpired"))
      return null
    }
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
    const res = await apiFetch(`/api/v1/catalog/products?q=${encodeURIComponent(q)}&limit=8`)
    if (res.ok) {
      const body = await res.json()
      setPickerProducts(body.products)
    }
  }

  async function place(product: PickerProduct, shelfId = selectedShelfId, xMm?: number) {
    if (!shelfId || readOnly || !product.hasDimensions || isBusy) return
    setPendingAction("place")
    try {
      const res = await apiFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          shelfId,
          productId: product.id,
          ...(xMm == null ? {} : { xMm }),
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
            shelfId,
            xMm: body.xMm as number,
            widthMm: product.widthMm ?? 0,
            heightMm: product.heightMm ?? 0,
            depthMm: product.depthMm ?? 0,
            facingsX: 1,
            facingsY: 1,
            facingsZ: 1,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            stackMode: "NONE",
            product: {
              id: product.id,
              sku: product.sku,
              barcode: product.barcode,
              name: product.name,
              brandName: null,
              imageKey: product.imageKey,
            },
          },
        ])
        setSelectedPlacementId(body.placementId as string)
        setSelectedShelfId(shelfId)
        setSelectedPickerProduct(null)
      }
    } finally {
      setPendingAction(null)
    }
  }

  async function placeSelectedProductAt(event: MouseEvent<SVGSVGElement | SVGGElement>, shelfId: string) {
    if (!selectedPickerProduct?.hasDimensions || readOnly) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointInSvg(event)
    if (!point) return
    const draftPlacement: EditorPlacement = {
      id: "draft",
      shelfId,
      xMm: 0,
      widthMm: selectedPickerProduct.widthMm ?? 0,
      heightMm: selectedPickerProduct.heightMm ?? 0,
      depthMm: selectedPickerProduct.depthMm ?? 0,
      facingsX: 1,
      facingsY: 1,
      facingsZ: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      stackMode: "NONE",
      product: {
        id: selectedPickerProduct.id,
        sku: selectedPickerProduct.sku,
        barcode: selectedPickerProduct.barcode,
        name: selectedPickerProduct.name,
        brandName: null,
        imageKey: selectedPickerProduct.imageKey,
      },
    }
    await place(selectedPickerProduct, shelfId, snappedXMm(point.x / k, draftPlacement))
  }

  async function duplicatePlacement(placement: EditorPlacement) {
    if (readOnly || isBusy) return
    setPendingAction("duplicate")
    try {
      const res = await apiFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          shelfId: placement.shelfId,
          productId: placement.product.id,
          facingsX: placement.facingsX,
          facingsY: placement.facingsY,
          facingsZ: placement.facingsZ,
          rotationX: placement.rotationX,
          rotationY: placement.rotationY,
          rotationZ: placement.rotationZ,
          stackMode: placement.stackMode,
        }),
      })
      const body = await handleResponse(res)
      if (!body) return
      setRevision(body.revision as string)
      const next: EditorPlacement = {
        ...placement,
        id: body.placementId as string,
        xMm: body.xMm as number,
      }
      setPlacements((prev) => [...prev, next])
      setSelectedPlacementId(next.id)
    } finally {
      setPendingAction(null)
    }
  }

  async function patchPlacement(id: string, patch: Record<string, number | string>) {
    if (readOnly || isBusy) return
    setPendingAction("patch")
    try {
      const res = await apiFetch(`${base}/${id}`, {
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
    } finally {
      setPendingAction(null)
    }
  }

  async function deletePlacementWithRevision(id: string, expectedRevision: string) {
    const res = await apiFetch(`${base}/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision }),
    })
    return handleResponse(res)
  }

  async function deletePlacement(id: string) {
    if (readOnly || isBusy) return
    setPendingAction("delete")
    try {
      const body = await deletePlacementWithRevision(id, revision)
      if (body) {
        setRevision(body.revision as string)
        setPlacements((prev) => prev.filter((p) => p.id !== id))
        setSelectedPlacementId(null)
      }
    } finally {
      setPendingAction(null)
    }
  }

  async function undoAutoFill() {
    if (readOnly || isBusy || lastAutoFillIds.length === 0) return
    setPendingAction("undoAutoFill")
    try {
      let nextRevision = revision
      for (const id of lastAutoFillIds) {
        const body = await deletePlacementWithRevision(id, nextRevision)
        if (!body) return
        nextRevision = body.revision as string
      }
      setRevision(nextRevision)
      setPlacements((prev) => prev.filter((placement) => !lastAutoFillIds.includes(placement.id)))
      setSelectedPlacementId(null)
      setLastAutoFillIds([])
      setAutoLog(t("autoUndoComplete", { count: lastAutoFillIds.length }))
      router.refresh()
    } finally {
      setPendingAction(null)
    }
  }

  async function createGoldenReference() {
    if (!selectedGoldenPhotoId || isBusy) return
    setPendingAction("goldenReference")
    try {
      const res = await apiFetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/golden-reference`, {
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
    } finally {
      setPendingAction(null)
    }
  }

  async function deleteGoldenReference(referenceId: string) {
    const confirmed = window.confirm(t("confirmDeleteReference"))
    if (!confirmed) return
    const res = await apiFetch(`${goldenReferenceBase}/${referenceId}`, { method: "DELETE" })
    const body = await handleResponse(res)
    if (!body) return
    setReferences((prev) => prev.filter((ref) => ref.id !== referenceId))
    setSelectedReferenceSlotId(null)
    setActiveReferenceId((current) => {
      if (current !== referenceId) return current
      const next = references.find((ref) => ref.id !== referenceId)
      return next?.id ?? ""
    })
  }

  function editReferenceSlot(slot: GoldenReferenceSlot) {
    setSelectedReferenceSlotId(slot.id)
    setSlotPlacementId(slot.placementId ?? placements[0]?.id ?? "")
    setSlotDraft({
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    })
  }

  function slotFromResponse(body: Record<string, unknown>): GoldenReferenceSlot {
    return {
      id: body.id as string,
      placementId: body.placementId as string | null,
      productId: body.productId as string | null,
      productSku: body.productSku as string | null,
      productName: body.productName as string | null,
      label: body.label as string | null,
      xPct: body.xPct as number,
      yPct: body.yPct as number,
      widthPct: body.widthPct as number,
      heightPct: body.heightPct as number,
    }
  }

  function updateReferenceSlotLocal(referenceId: string, updatedSlot: GoldenReferenceSlot) {
    setReferences((prev) =>
      prev.map((ref) =>
        ref.id === referenceId
          ? { ...ref, slots: ref.slots.map((slot) => (slot.id === updatedSlot.id ? updatedSlot : slot)) }
          : ref,
      ),
    )
  }

  function patchReferenceSlotDraft(slotId: string, draft: ReferenceSlotDraft) {
    setReferences((prev) =>
      prev.map((ref) =>
        ref.id === activeReference?.id
          ? {
              ...ref,
              slots: ref.slots.map((slot) => (slot.id === slotId ? { ...slot, ...draft } : slot)),
            }
          : ref,
      ),
    )
  }

  async function persistReferenceSlotDraft(referenceId: string, slotId: string, draft: ReferenceSlotDraft) {
    const res = await apiFetch(`${goldenReferenceBase}/${referenceId}/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    const body = await handleResponse(res)
    if (!body) return
    updateReferenceSlotLocal(referenceId, slotFromResponse(body))
  }

  function roundedPct(value: number) {
    return Math.round(value * 10) / 10
  }

  function clampPct(value: number, min = 0, max = 100) {
    return Math.min(max, Math.max(min, value))
  }

  function normalizedSlotDraft(draft: ReferenceSlotDraft): ReferenceSlotDraft {
    const widthPct = roundedPct(clampPct(draft.widthPct, 1, 100))
    const heightPct = roundedPct(clampPct(draft.heightPct, 1, 100))
    return {
      widthPct,
      heightPct,
      xPct: roundedPct(clampPct(draft.xPct, 0, 100 - widthPct)),
      yPct: roundedPct(clampPct(draft.yPct, 0, 100 - heightPct)),
    }
  }

  function referenceDraftForPlacement(placement: EditorPlacement): ReferenceSlotDraft {
    const shelf = equipment.shelves.find((item) => item.id === placement.shelfId)
    const oriented = orientedProductSizeMm(placement)
    const widthPct = clampPct((placementWidthMm(placement) / equipment.widthMm) * 100, 4, 35)
    const heightPct = clampPct(((oriented.heightMm * placement.facingsY) / equipment.heightMm) * 100, 4, 30)
    const yMm = shelf ? shelf.yMm + shelf.thicknessMm : 0
    return normalizedSlotDraft({
      xPct: (placement.xMm / equipment.widthMm) * 100,
      yPct: 100 - ((yMm + oriented.heightMm * placement.facingsY) / equipment.heightMm) * 100,
      widthPct,
      heightPct,
    })
  }

  function referencePointInPct(event: PointerEvent<HTMLElement>) {
    const rect = referenceImageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      xPct: clampPct(((event.clientX - rect.left) / rect.width) * 100),
      yPct: clampPct(((event.clientY - rect.top) / rect.height) * 100),
    }
  }

  function beginReferenceSlotDrag(event: PointerEvent<HTMLElement>, slot: GoldenReferenceSlot, mode: ReferenceSlotDrag["mode"]) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = referencePointInPct(event)
    if (!point) return
    const draft = {
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    }
    editReferenceSlot(slot)
    const nextDrag = {
      slotId: slot.id,
      mode,
      offsetXPct: point.xPct - slot.xPct,
      offsetYPct: point.yPct - slot.yPct,
      draft,
    }
    referenceSlotDragRef.current = nextDrag
    setReferenceSlotDrag(nextDrag)
  }

  function moveReferenceSlotDrag(event: PointerEvent<HTMLDivElement>) {
    if (!referenceSlotDrag) return
    event.preventDefault()
    const point = referencePointInPct(event)
    if (!point) return
    const current = referenceSlotDrag.draft
    const next =
      referenceSlotDrag.mode === "move"
        ? {
            ...current,
            xPct: roundedPct(clampPct(point.xPct - referenceSlotDrag.offsetXPct, 0, 100 - current.widthPct)),
            yPct: roundedPct(clampPct(point.yPct - referenceSlotDrag.offsetYPct, 0, 100 - current.heightPct)),
          }
        : {
            ...current,
            widthPct: roundedPct(clampPct(point.xPct - current.xPct, 1, 100 - current.xPct)),
            heightPct: roundedPct(clampPct(point.yPct - current.yPct, 1, 100 - current.yPct)),
          }
    const nextDrag = { ...referenceSlotDrag, draft: next }
    referenceSlotDragRef.current = nextDrag
    setReferenceSlotDrag(nextDrag)
    setSlotDraft(next)
    patchReferenceSlotDraft(referenceSlotDrag.slotId, next)
  }

  async function finishReferenceSlotDrag() {
    const state = referenceSlotDragRef.current
    referenceSlotDragRef.current = null
    setReferenceSlotDrag(null)
    if (!state || !activeReference) return
    await persistReferenceSlotDraft(activeReference.id, state.slotId, state.draft)
  }

  async function createReferenceSlotForPlacement(placement: EditorPlacement, draft = slotDraft) {
    if (!activeReference) return null
    const res = await apiFetch(`${goldenReferenceBase}/${activeReference.id}/slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placementId: placement.id,
        label: placement.product.name,
        ...normalizedSlotDraft(draft),
      }),
    })
    const body = await handleResponse(res)
    if (!body) return null

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
    setSelectedReferenceSlotId(slot.id)
    return slot
  }

  async function createReferenceSlot() {
    if (!slotPlacement) return
    await createReferenceSlotForPlacement(slotPlacement, slotDraft)
  }

  async function createMissingReferenceSlots() {
    if (!activeReference || referenceMissingPlacements.length === 0) return
    for (const placement of referenceMissingPlacements) {
      await createReferenceSlotForPlacement(placement, referenceDraftForPlacement(placement))
    }
  }

  async function updateReferenceSlot() {
    if (!activeReference || !selectedReferenceSlot || !slotPlacement) return
    const res = await apiFetch(`${goldenReferenceBase}/${activeReference.id}/slots/${selectedReferenceSlot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placementId: slotPlacement.id,
        label: slotPlacement.product.name,
        ...slotDraft,
      }),
    })
    const body = await handleResponse(res)
    if (!body) return

    updateReferenceSlotLocal(activeReference.id, slotFromResponse(body))
  }

  function resetReferenceSlotDraft() {
    setSelectedReferenceSlotId(null)
    setSlotPlacementId(placements[0]?.id ?? "")
    setSlotDraft({ xPct: 5, yPct: 5, widthPct: 20, heightPct: 20 })
  }

  async function deleteReferenceSlot(referenceId: string, slotId: string) {
    const res = await apiFetch(`${goldenReferenceBase}/${referenceId}/slots/${slotId}`, { method: "DELETE" })
    const body = await handleResponse(res)
    if (!body) return
    setReferences((prev) =>
      prev.map((ref) =>
        ref.id === referenceId ? { ...ref, slots: ref.slots.filter((slot) => slot.id !== slotId) } : ref,
      ),
    )
    if (selectedReferenceSlotId === slotId) resetReferenceSlotDraft()
  }

  function nudgeReferenceSlot(dx: number, dy: number, dw = 0, dh = 0) {
    const next = normalizedSlotDraft({
      xPct: slotDraft.xPct + dx,
      yPct: slotDraft.yPct + dy,
      widthPct: slotDraft.widthPct + dw,
      heightPct: slotDraft.heightPct + dh,
    })
    setSlotDraft(next)
    if (selectedReferenceSlotId) patchReferenceSlotDraft(selectedReferenceSlotId, next)
  }

  async function createZone() {
    if (readOnly || isBusy) return
    setPendingAction("zone")
    try {
      const res = await apiFetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, ...zoneDraft }),
      })
      const body = await handleResponse(res)
      if (!body) return
      setRevision(body.revision as string)
      setZones((prev) => [
        ...prev,
        {
          id: body.id as string,
          name: body.name as string,
          color: body.color as string | null,
          xMm: body.xMm as number,
          yMm: body.yMm as number,
          widthMm: body.widthMm as number,
          heightMm: body.heightMm as number,
        },
      ])
      updateAutoRule({ zoneId: autoRule.zoneId || (body.id as string) })
      setZoneDraft((prev) => ({ ...prev, name: "" }))
    } finally {
      setPendingAction(null)
    }
  }

  async function deleteZone(zoneId: string) {
    if (readOnly || isBusy) return
    setPendingAction("zone")
    try {
      const res = await apiFetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/zones/${zoneId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      })
      const body = await handleResponse(res)
      if (!body) return
      setRevision(body.revision as string)
      setZones((prev) => prev.filter((zone) => zone.id !== zoneId))
      updateAutoRule({ zoneId: autoRule.zoneId === zoneId ? "" : autoRule.zoneId })
    } finally {
      setPendingAction(null)
    }
  }

  function autoFillPayload(preview: boolean) {
    return {
      expectedRevision: revision,
      preview,
      categoryId: autoRule.categoryId || null,
      brandId: autoRule.brandId || null,
      supplierId: autoRule.supplierId || null,
      sortBy: autoRule.sortBy,
      facingsBy: autoRule.facingsBy,
      excludeSkus: autoRule.excludeSkus
        .split(/[,\n]/)
        .map((sku) => sku.trim())
        .filter(Boolean),
      maxBrandSharePct: autoRule.maxBrandSharePct,
      autoCompressSoftPacks: autoRule.autoCompressSoftPacks,
      limit: autoRule.limit,
    }
  }

  async function previewAutoFillZone() {
    if (!autoRule.zoneId || readOnly || isBusy) return
    setPendingAction("autoPreview")
    try {
      const res = await apiFetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/zones/${autoRule.zoneId}/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(autoFillPayload(true)),
      })
      const body = await handleResponse(res)
      if (!body) return
      const preview = (body.placements as AutoPreviewPlacement[]) ?? []
      setAutoPreview({
        placements: preview,
        rejectedCount: Number(body.rejectedCount ?? 0),
      })
      setLastAutoFillIds([])
      setAutoLog(preview.length === 0 ? t("autoPreviewEmpty") : null)
    } finally {
      setPendingAction(null)
    }
  }

  async function applyAutoFillZone() {
    if (!autoRule.zoneId || readOnly || isBusy || !autoPreview) return
    setPendingAction("autoApply")
    try {
      const res = await apiFetch(`/api/v1/planograms/${planogram.id}/versions/${version.id}/zones/${autoRule.zoneId}/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(autoFillPayload(false)),
      })
      const body = await handleResponse(res)
      if (!body) return
      const created = (body.placements as EditorPlacement[]) ?? []
      setRevision(body.revision as string)
      setPlacements((prev) => [...prev, ...created])
      setLastAutoFillIds(created.map((placement) => placement.id))
      setAutoPreview(null)
      const log = body.log as { placed?: unknown[]; rejected?: unknown[] } | undefined
      setAutoLog(t("autoLog", { placed: log?.placed?.length ?? 0, rejected: log?.rejected?.length ?? 0 }))
      router.refresh()
    } finally {
      setPendingAction(null)
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
        item.rotationX,
        item.rotationY,
        item.rotationZ,
        item.stackMode,
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
      item.rotationX,
      item.rotationY,
      item.rotationZ,
      item.stackMode,
      item.widthMm,
      item.heightMm,
      item.depthMm,
    ].join(":")
  }

  function formatMoney(value: number | null, currency: string | null = "AZN") {
    if (value == null) return "—"
    return `${value.toFixed(2)} ${currency ?? "AZN"}`
  }

  function formatDays(value: number | null) {
    return value == null ? "—" : value.toFixed(1)
  }

  function pointInSvg(event: { clientX: number; clientY: number }) {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(matrix.inverse())
  }

  function pointInSvgFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
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
    const max = Math.max(0, equipment.widthMm - placementWidthMm(placement))
    return Math.max(0, Math.min(max, Math.round(rawMm / 10) * 10))
  }

  function startDrag(event: PointerEvent<SVGGElement>, placement: EditorPlacement) {
    if (readOnly || isBusy) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointInSvg(event)
    if (!point) return
    setSelectedPickerProduct(null)
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

  function handleCatalogDragStart(event: DragEvent<HTMLElement>, product: PickerProduct) {
    if (!product.hasDimensions) return
    event.dataTransfer.setData("text/plain", product.id)
    event.dataTransfer.effectAllowed = "copy"
    setDraggingProductId(product.id)
    setSelectedPickerProduct(product)
    setSelectedPlacementId(null)
  }

  async function handleCatalogDrop(event: DragEvent<SVGSVGElement>) {
    event.preventDefault()
    const productId = event.dataTransfer.getData("text/plain") || draggingProductId
    const product = pickerProducts.find((item) => item.id === productId)
    const point = pointInSvgFromClient(event.clientX, event.clientY)
    setDraggingProductId(null)
    if (!product || !point) return
    const shelfId = shelfIdForSvgY(point.y) ?? selectedShelfId
    if (!shelfId) return
    const draftPlacement: EditorPlacement = {
      id: "draft",
      shelfId,
      xMm: 0,
      widthMm: product.widthMm ?? 0,
      heightMm: product.heightMm ?? 0,
      depthMm: product.depthMm ?? 0,
      facingsX: 1,
      facingsY: 1,
      facingsZ: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      stackMode: "NONE",
      product: {
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        brandName: null,
        imageKey: product.imageKey,
      },
    }
    await place(product, shelfId, snappedXMm(point.x / k, draftPlacement))
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
                const res = await apiFetch(
                  `/api/v1/planograms/${planogram.id}/versions/${version.id}/next-draft`,
                  { method: "POST" },
                )
                if (res.ok) {
                  const body = await res.json()
                  router.push(`/${locale}/planograms/${planogram.id}/${body.versionId}`)
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

      <div className="mb-4 grid gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-600 md:grid-cols-4">
        <div>
          <div className="font-medium text-neutral-900">{t("workflow.selectShelfTitle")}</div>
          <p className="mt-1">{t("workflow.selectShelfBody")}</p>
        </div>
        <div>
          <div className="font-medium text-neutral-900">{t("workflow.addProductTitle")}</div>
          <p className="mt-1">{t("workflow.addProductBody")}</p>
        </div>
        <div>
          <div className="font-medium text-neutral-900">{t("workflow.moveProductTitle")}</div>
          <p className="mt-1">{t("workflow.moveProductBody")}</p>
        </div>
        <div>
          <div className="font-medium text-neutral-900">{t("workflow.referenceTitle")}</div>
          <p className="mt-1">{t("workflow.referenceBody")}</p>
        </div>
      </div>

      {!readOnly ? (
        <div className="mb-4 rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{t("workbench")}</h2>
              <p className="mt-1 text-xs text-neutral-500">{t("quickAddHint")}</p>
            </div>
            {isBusy ? <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{t("saving")}</span> : null}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => searchProducts(e.target.value)}
            placeholder={t("searchProducts")}
            className="mt-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          {pickerProducts.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pickerProducts.map((p) => (
                <button
                  key={p.id}
                  draggable={p.hasDimensions}
                  onDragStart={(event) => handleCatalogDragStart(event, p)}
                  onDragEnd={() => setDraggingProductId(null)}
                  onClick={() => {
                    setSelectedPickerProduct(p)
                    setSelectedPlacementId(null)
                  }}
                  disabled={!p.hasDimensions || isBusy}
                  className={`flex min-w-52 items-center gap-2 rounded-md border px-2 py-2 text-left text-sm disabled:opacity-40 ${
                    selectedPickerProduct?.id === p.id ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-neutral-50"
                  }`}
                  title={p.hasDimensions ? p.name : t("noDims")}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded text-xs font-bold text-white"
                    style={{ backgroundColor: colorFor(p.sku) }}
                  >
                    {p.imageKey ? <img src={`/api/media/${p.imageKey}`} alt="" className="h-full w-full object-cover" /> : p.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-neutral-900">{p.name}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      {p.sku} · {p.widthMm ?? "—"}mm
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {selectedPickerProduct ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-neutral-900">{selectedPickerProduct.name}</div>
                <div className="text-xs text-amber-700">{t("selectedCatalogProductHint")}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void place(selectedPickerProduct)}
                  disabled={!selectedShelfId || !selectedPickerProduct.hasDimensions || isBusy}
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  {pendingAction === "place" ? t("saving") : t("placeOnSelectedShelf")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPickerProduct(null)}
                  disabled={isBusy}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40"
                >
                  {t("cancelSelection")}
                </button>
              </div>
            </div>
          ) : selectedPlacement ? (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs font-medium text-neutral-500">{t("selectedPlacement")}</div>
              <div className="mt-1 truncate text-sm font-medium text-neutral-900">{selectedPlacement.product.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void duplicatePlacement(selectedPlacement)}
                  disabled={isBusy}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40"
                >
                  {t("duplicatePlacement")}
                </button>
                <button
                  type="button"
                  onClick={() => deletePlacement(selectedPlacement.id)}
                  disabled={isBusy}
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  {t("remove")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(760px,1fr)_420px]">
        {/* Canvas */}
        <div className="min-w-0 overflow-x-auto">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className={`rounded-md border border-neutral-300 bg-neutral-50 ${
              selectedPickerProduct?.hasDimensions ? "cursor-crosshair" : ""
            }`}
            onPointerMove={moveDrag}
            onPointerUp={() => void finishDrag()}
            onPointerCancel={() => setDrag(null)}
            onClick={(event) => {
              if (!selectedPickerProduct?.hasDimensions || readOnly) return
              const point = pointInSvg(event)
              const shelfId = point ? shelfIdForSvgY(point.y) ?? selectedShelfId : selectedShelfId
              if (shelfId) void placeSelectedProductAt(event, shelfId)
            }}
            onDragOver={(event) => {
              if (draggingProductId) event.preventDefault()
            }}
            onDrop={(event) => void handleCatalogDrop(event)}
          >
            {zones.map((zone) => {
              const color = zone.color ?? "#f59e0b"
              return (
                <g key={zone.id} style={{ pointerEvents: "none" }}>
                  <rect
                    x={zone.xMm * k}
                    y={H - (zone.yMm + zone.heightMm) * k}
                    width={zone.widthMm * k}
                    height={zone.heightMm * k}
                    fill={color}
                    opacity={0.12}
                    stroke={color}
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                  <text x={zone.xMm * k + 4} y={H - (zone.yMm + zone.heightMm) * k + 14} fontSize={10} fill={color}>
                    {zone.name}
                  </text>
                </g>
              )
            })}

            {shelfInfos.map(({ shelf, space }) => {
              const yTop = H - (shelf.yMm + shelf.thicknessMm) * k
              const selected = shelf.id === selectedShelfId
              return (
                <g
                  key={shelf.id}
                  onClick={(event) => {
                    setSelectedShelfId(shelf.id)
                    if (selectedPickerProduct?.hasDimensions) void placeSelectedProductAt(event, shelf.id)
                  }}
                  className="cursor-pointer"
                >
                  {/* зона просвета полки (кликабельна) */}
                  <rect
                    x={0}
                    y={yTop - space.clearanceHeightMm * k}
                    width={W}
                    height={space.clearanceHeightMm * k}
                    fill={selected ? "#fef3c7" : "transparent"}
                    opacity={selected ? 0.5 : 1}
                  />
                  {selectedPickerProduct?.hasDimensions && selected ? (
                    <text
                      x={8}
                      y={yTop - space.clearanceHeightMm * k + 16}
                      fontSize={10}
                      fill="#92400e"
                      style={{ pointerEvents: "none" }}
                    >
                      {t("clickShelfToPlace", { sku: selectedPickerProduct.sku })}
                    </text>
                  ) : null}
                  <rect x={0} y={yTop} width={W} height={Math.max(2, shelf.thicknessMm * k)} fill="#78716c" />
                </g>
              )
            })}

            {placements.map((p) => {
              const dragState = drag?.placementId === p.id ? drag : null
              const shelf = equipment.shelves.find((s) => s.id === (dragState?.shelfId ?? p.shelfId))
              if (!shelf) return null
              const oriented = orientedProductSizeMm(p)
              const faceWidthPx = oriented.widthMm * (p.compressionX ?? 1) * k
              const wPx = faceWidthPx * p.facingsX
              const hPx = oriented.heightMm * p.facingsY * k
              const x = (dragState?.xMm ?? p.xMm) * k
              const y = H - (shelf.yMm + shelf.thicknessMm + oriented.heightMm * p.facingsY) * k
              const isSel = p.id === selectedPlacementId
              const diffKind = diff.currentMarks.get(editorPlacementDiffKey(p))
              const metric = metricsByProductId.get(p.product.id)
              return (
                <g
                  key={p.id}
                  onPointerDown={(e) => startDrag(e, p)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedPickerProduct(null)
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
                      x1={x + (i + 1) * faceWidthPx}
                      y1={y}
                      x2={x + (i + 1) * faceWidthPx}
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
                  {dragState && metric ? (
                    <text x={x + 3} y={y + hPx + 12} fontSize={9} fill="#111827" style={{ pointerEvents: "none" }}>
                      {metric.abcClass} · {formatMoney(metric.turnoverPerDay, metric.currency)}/d · {formatDays(metric.stockDays)}d
                    </text>
                  ) : null}
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
        <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:max-h-[calc(100vh-1.5rem)] xl:overflow-y-auto xl:pr-1">
          {!readOnly ? (
            <div className="hidden rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:sticky xl:top-3 xl:z-10 xl:block">
              <h2 className="text-sm font-semibold">{t("workbench")}</h2>
              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-neutral-700">{t("quickAddTitle")}</div>
                    <p className="mt-1 text-xs text-neutral-500">{t("quickAddHint")}</p>
                  </div>
                  {selectedPickerProduct ? (
                    <button
                      type="button"
                      onClick={() => void place(selectedPickerProduct)}
                      disabled={!selectedShelfId || !selectedPickerProduct.hasDimensions || isBusy}
                      className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
                    >
                      {pendingAction === "place" ? t("saving") : t("placeOnSelectedShelf")}
                    </button>
                  ) : null}
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => searchProducts(e.target.value)}
                  placeholder={t("searchProducts")}
                  className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
                />
                {pickerProducts.length > 0 ? (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {pickerProducts.map((p) => (
                      <button
                        key={p.id}
                        draggable={p.hasDimensions}
                        onDragStart={(event) => handleCatalogDragStart(event, p)}
                        onDragEnd={() => setDraggingProductId(null)}
                        onClick={() => {
                          setSelectedPickerProduct(p)
                          setSelectedPlacementId(null)
                        }}
                        disabled={!p.hasDimensions || isBusy}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white disabled:opacity-40 ${
                          selectedPickerProduct?.id === p.id ? "bg-amber-50 ring-1 ring-amber-200" : ""
                        }`}
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
                        <span className="text-[11px] text-neutral-400">{p.widthMm ?? "—"}mm</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {selectedPickerProduct ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-medium text-amber-800">{t("selectedCatalogProduct")}</div>
                  <div className="mt-1 text-sm font-medium text-neutral-900">{selectedPickerProduct.name}</div>
                  <div className="mt-1 text-xs text-neutral-600">
                    {selectedPickerProduct.sku} · {selectedPickerProduct.widthMm}×{selectedPickerProduct.heightMm}×{selectedPickerProduct.depthMm} mm
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void place(selectedPickerProduct)}
                      disabled={!selectedShelfId || !selectedPickerProduct.hasDimensions || isBusy}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
                    >
                      {pendingAction === "place" ? t("saving") : t("placeOnSelectedShelf")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPickerProduct(null)}
                      disabled={isBusy}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-white disabled:opacity-40"
                    >
                      {t("cancelSelection")}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-amber-700">{t("selectedCatalogProductHint")}</p>
                </div>
              ) : null}

              {selectedPlacement ? (
                <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="text-xs font-medium text-neutral-500">{t("selectedPlacement")}</div>
                  <div className="mt-1 text-sm font-medium text-neutral-900">{selectedPlacement.product.name}</div>
                  <div className="mt-1 text-xs text-neutral-600">
                    {selectedPlacement.product.sku} · {selectedPlacement.widthMm}×{selectedPlacement.heightMm}×{selectedPlacement.depthMm} mm
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <label className="block text-xs">
                      <span className="text-neutral-500">{t("moveToShelf")}</span>
                      <select
                        value={selectedPlacement.shelfId}
                        onChange={(e) => patchPlacement(selectedPlacement.id, { shelfId: e.target.value })}
                        disabled={isBusy}
                        className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1"
                      >
                        {equipment.shelves.map((shelf) => (
                          <option key={shelf.id} value={shelf.id}>
                            {t("shelf")} {shelf.shelfIndex + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs">
                      <span className="text-neutral-500">{t("position")}</span>
                      <input
                        type="number"
                        min={0}
                        value={selectedPlacement.xMm}
                        onChange={(e) =>
                          patchPlacement(selectedPlacement.id, { xMm: Number.parseInt(e.target.value || "0", 10) })
                        }
                        disabled={isBusy}
                        className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1"
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-neutral-500">{t("facingsX")}</span>
                      <input
                        type="number"
                        min={1}
                        value={selectedPlacement.facingsX}
                        onChange={(e) =>
                          patchPlacement(selectedPlacement.id, { facingsX: Number.parseInt(e.target.value || "1", 10) })
                        }
                        disabled={isBusy}
                        className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1"
                      />
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => patchPlacement(selectedPlacement.id, { xMm: Math.max(0, selectedPlacement.xMm - 10) })}
                      disabled={isBusy}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {t("nudgeLeft")}
                    </button>
                    <button
                      type="button"
                      onClick={() => patchPlacement(selectedPlacement.id, { xMm: selectedPlacement.xMm + 10 })}
                      disabled={isBusy}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {t("nudgeRight")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicatePlacement(selectedPlacement)}
                      disabled={isBusy}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {t("duplicatePlacement")}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePlacement(selectedPlacement.id)}
                      disabled={isBusy}
                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      {t("remove")}
                    </button>
                  </div>
                </div>
              ) : !selectedPickerProduct ? (
                <p className="mt-2 text-xs text-neutral-500">{t("workbenchEmpty")}</p>
              ) : null}
            </div>
          ) : null}

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

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium">{t("zones")}</h2>
            {zones.length === 0 ? (
              <p className="mb-2 text-xs text-neutral-500">{t("noZones")}</p>
            ) : (
              <div className="mb-3 space-y-1">
                {zones.map((zone) => (
                  <div key={zone.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-neutral-50 px-2 py-2 text-xs">
                    <span className="h-4 w-4 rounded-sm border border-white shadow-sm" style={{ backgroundColor: zone.color ?? "#f59e0b" }} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-neutral-800">{zone.name}</span>
                      <span className="block text-neutral-500">
                        {t("zoneSize", { width: zone.widthMm, height: zone.heightMm })} · {t("zoneOrigin", { x: zone.xMm, y: zone.yMm })}
                      </span>
                    </span>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => deleteZone(zone.id)}
                        disabled={isBusy}
                        className="rounded-md border border-red-200 bg-white px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        {t("deleteReferenceSlot")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {!readOnly ? (
              <div className="space-y-2 border-t border-neutral-100 pt-3">
                <input
                  value={zoneDraft.name}
                  onChange={(e) => setZoneDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t("zoneName")}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <div className="grid grid-cols-5 gap-2">
                  <label className="block text-xs">
                    <span className="text-neutral-500">{t("zoneColor")}</span>
                    <input
                      type="color"
                      value={zoneDraft.color}
                      onChange={(e) => setZoneDraft((prev) => ({ ...prev, color: e.target.value }))}
                      className="mt-1 h-8 w-full rounded border border-neutral-300"
                    />
                  </label>
                  {(["xMm", "yMm", "widthMm", "heightMm"] as const).map((field) => (
                    <label key={field} className="block text-xs">
                      <span className="text-neutral-500">{t(`zoneFields.${field}` as never)}</span>
                      <input
                        type="number"
                        min={field === "widthMm" || field === "heightMm" ? 1 : 0}
                        value={zoneDraft[field]}
                        onChange={(e) =>
                          setZoneDraft((prev) => ({ ...prev, [field]: Number.parseInt(e.target.value || "0", 10) }))
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!zoneDraft.name.trim() || isBusy}
                  onClick={createZone}
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                >
                  {t("addZone")}
                </button>
              </div>
            ) : null}
          </div>

          {!readOnly ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h2 className="text-sm font-medium">{t("autoPlacement")}</h2>
              <p className="mt-1 text-xs text-neutral-500">{t("autoPlacementHint")}</p>
              <div className="my-3 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
                <div className="font-medium text-neutral-700">
                  {activeAutoZone ? t("autoTargetZone", { zone: activeAutoZone.name }) : t("autoNoZone")}
                </div>
                <div className="mt-1 text-neutral-500">
                  {t("autoRuleSummary", {
                    sort: t(`auto.${autoRule.sortBy}` as never),
                    facings: t(`auto.${autoRule.facingsBy}` as never),
                    limit: autoRule.limit,
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <select
                  value={autoRule.zoneId}
                  onChange={(e) => updateAutoRule({ zoneId: e.target.value })}
                  disabled={isBusy}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="">{t("selectZone")}</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={autoRule.categoryId}
                    onChange={(e) => updateAutoRule({ categoryId: e.target.value })}
                    disabled={isBusy}
                    className="min-w-0 rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">{t("allCategories")}</option>
                    {autoPlacementOptions.categories.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={autoRule.brandId}
                    onChange={(e) => updateAutoRule({ brandId: e.target.value })}
                    disabled={isBusy}
                    className="min-w-0 rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">{t("allBrands")}</option>
                    {autoPlacementOptions.brands.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={autoRule.supplierId}
                    onChange={(e) => updateAutoRule({ supplierId: e.target.value })}
                    disabled={isBusy}
                    className="min-w-0 rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">{t("allSuppliers")}</option>
                    {autoPlacementOptions.suppliers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">
                    <span className="text-neutral-500">{t("sortBy")}</span>
                    <select
                      value={autoRule.sortBy}
                      onChange={(e) => updateAutoRule({ sortBy: e.target.value })}
                      disabled={isBusy}
                      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                    >
                      {["turnover", "profit", "quantity", "name", "height"].map((value) => (
                        <option key={value} value={value}>
                          {t(`auto.${value}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="text-neutral-500">{t("facingsBy")}</span>
                    <select
                      value={autoRule.facingsBy}
                      onChange={(e) => updateAutoRule({ facingsBy: e.target.value })}
                      disabled={isBusy}
                      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                    >
                      {["turnover", "profit", "quantity"].map((value) => (
                        <option key={value} value={value}>
                          {t(`auto.${value}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="text-neutral-500">{t("limit")}</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={autoRule.limit}
                      onChange={(e) => updateAutoRule({ limit: Number.parseInt(e.target.value || "1", 10) })}
                      disabled={isBusy}
                      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs">
                    <span className="text-neutral-500">{t("excludeSkus")}</span>
                    <input
                      value={autoRule.excludeSkus}
                      onChange={(e) => updateAutoRule({ excludeSkus: e.target.value })}
                      disabled={isBusy}
                      placeholder="SKU1, SKU2"
                      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                    />
                  </label>
                  <div className="grid gap-2">
                    <label className="block text-xs">
                      <span className="text-neutral-500">{t("maxBrandShare")}</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={autoRule.maxBrandSharePct}
                        onChange={(e) =>
                          updateAutoRule({ maxBrandSharePct: Number.parseInt(e.target.value || "100", 10) })
                        }
                        disabled={isBusy}
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-neutral-600">
                      <input
                        type="checkbox"
                        checked={autoRule.autoCompressSoftPacks}
                        onChange={(e) => updateAutoRule({ autoCompressSoftPacks: e.target.checked })}
                        disabled={isBusy}
                      />
                      {t("autoCompressSoftPacks")}
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!autoRule.zoneId || isBusy}
                  onClick={previewAutoFillZone}
                  className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {pendingAction === "autoPreview" ? t("previewing") : t("previewAutoPlacement")}
                </button>
                {autoPreview ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {t("autoPreviewReady", { count: autoPreview.placements.length, rejected: autoPreview.rejectedCount })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAutoPreview(null)}
                        disabled={isBusy}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                      >
                        {t("resetPreview")}
                      </button>
                    </div>
                    {autoPreview.placements.length > 0 ? (
                      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                        {autoPreview.placements.slice(0, 8).map((placement) => (
                          <div key={`${placement.productId}-${placement.shelfId}-${placement.xMm}`} className="flex justify-between gap-2 rounded bg-white/70 px-2 py-1">
                            <span className="min-w-0 truncate">{placement.sku} · {placement.name}</span>
                            <span className="shrink-0 text-amber-700">
                              {t("previewPlacementMeta", { shelf: placement.shelfId.slice(-4), x: placement.xMm, facings: placement.facingsX })}
                            </span>
                          </div>
                        ))}
                        {autoPreview.placements.length > 8 ? (
                          <div className="px-2 text-amber-700">+{autoPreview.placements.length - 8}</div>
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={applyAutoFillZone}
                      disabled={autoPreview.placements.length === 0 || isBusy}
                      className="mt-2 w-full rounded-md bg-amber-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      {pendingAction === "autoApply" ? t("saving") : t("applyAutoPlacement", { count: autoPreview.placements.length })}
                    </button>
                  </div>
                ) : null}
                {lastAutoFillIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={undoAutoFill}
                    disabled={isBusy}
                    className="w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {pendingAction === "undoAutoFill" ? t("saving") : t("undoAutoPlacement", { count: lastAutoFillIds.length })}
                  </button>
                ) : null}
                {autoLog ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
                    {autoLog}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

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
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">{t("goldenReference")}</h2>
                <p className="mt-1 text-xs text-neutral-500">{t("goldenReferenceHint")}</p>
              </div>
              {activeReference ? (
                <button
                  type="button"
                  onClick={() => deleteGoldenReference(activeReference.id)}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  {t("deleteReference")}
                </button>
              ) : null}
            </div>
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
                      onClick={() => {
                        setActiveReferenceId(ref.id)
                        setSelectedReferenceSlotId(null)
                      }}
                      className={`overflow-hidden rounded-md border text-left ${
                        ref.id === activeReference?.id ? "border-neutral-900" : "border-neutral-200"
                      }`}
                    >
                      <img src={`/api/media/${ref.imageUrl}`} alt="" className="h-24 w-full object-cover" />
                      <div className="flex items-center justify-between px-2 py-1 text-xs text-neutral-500">
                        <span>{t(`referenceStatus.${ref.status}` as never)}</span>
                        <span>{t("slotCount", { count: ref.slots.length })}</span>
                      </div>
                    </button>
                  ))}
                </div>
                {activeReference && (
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-neutral-500">
                        {t("referenceCoverage", {
                          covered: placements.length - referenceMissingPlacements.length,
                          total: placements.length,
                        })}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setReferenceZoom((value) => Math.max(100, value - 25))}
                          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                        >
                          -
                        </button>
                        <span className="w-12 text-center tabular-nums">{referenceZoom}%</span>
                        <button
                          type="button"
                          onClick={() => setReferenceZoom((value) => Math.min(250, value + 25))}
                          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="max-h-96 overflow-auto rounded-md border border-neutral-200 bg-neutral-100">
                      <div
                        ref={referenceImageRef}
                        className="relative touch-none select-none"
                        style={{ width: `${referenceZoom}%`, minWidth: "100%" }}
                        onPointerMove={moveReferenceSlotDrag}
                        onPointerUp={() => void finishReferenceSlotDrag()}
                        onPointerCancel={() => {
                          referenceSlotDragRef.current = null
                          setReferenceSlotDrag(null)
                        }}
                      >
                        <img
                          src={`/api/media/${activeReference.imageUrl}`}
                          alt=""
                          className="block w-full object-contain"
                          draggable={false}
                        />
                        {activeReference.slots.map((slot) => (
                          <div
                            key={slot.id}
                            onPointerDown={(event) => beginReferenceSlotDrag(event, slot, "move")}
                            className={`absolute cursor-move border-2 bg-emerald-400/15 ${
                              selectedReferenceSlotId === slot.id
                                ? "border-emerald-500 ring-2 ring-emerald-500/25"
                                : "border-emerald-400"
                            }`}
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
                            <span
                              onPointerDown={(event) => beginReferenceSlotDrag(event, slot, "resize")}
                              className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize border-l border-t border-white bg-emerald-600"
                              aria-hidden="true"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {activeReference.slots.length > 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">{t("dragReferenceSlotHint")}</p>
                    ) : null}
                    {activeReference.slots.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">{t("noReferenceSlots")}</p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {activeReference.slots.map((slot) => (
                          <div
                            key={slot.id}
                            className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ${
                              selectedReferenceSlotId === slot.id ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-neutral-50"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => editReferenceSlot(slot)}
                              className="min-w-0 flex-1 truncate text-left hover:text-neutral-900"
                            >
                              {slot.productSku ? `${slot.productSku} · ` : ""}
                              {slot.productName ?? slot.label}
                            </button>
                            <button
                              type="button"
                              onClick={() => editReferenceSlot(slot)}
                              className="text-neutral-600 hover:text-neutral-900"
                            >
                              {t("editReferenceSlot")}
                            </button>
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
                    {referenceMissingPlacements.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => void createMissingReferenceSlots()}
                        className="mt-2 w-full rounded-md border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        {t("createMissingReferenceSlots", { count: referenceMissingPlacements.length })}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            {goldenPhotoCandidates.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
                <p>{t("noGoldenPhotoCandidates")}</p>
                <p className="mt-1 text-neutral-500">{t("noGoldenPhotoCandidatesAction")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`/${locale}/tasks`}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    {t("openTasks")}
                  </a>
                  <a
                    href={`/${locale}/reviews`}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700"
                  >
                    {t("openReviews")}
                  </a>
                </div>
              </div>
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
                  disabled={isBusy}
                  className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {pendingAction === "goldenReference" ? t("saving") : t("createGoldenReference")}
                </button>
              </div>
            )}
            {activeReference && placements.length > 0 && (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-neutral-600">
                    {selectedReferenceSlot ? t("editReferenceSlotTitle") : t("referenceSlot")}
                  </h3>
                  {selectedReferenceSlot ? (
                    <button type="button" onClick={resetReferenceSlotDraft} className="text-xs text-neutral-500 hover:text-neutral-900">
                      {t("newReferenceSlot")}
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <select
                    value={slotPlacement?.id ?? ""}
                    onChange={(e) => {
                      setSlotPlacementId(e.target.value)
                      const placement = placements.find((item) => item.id === e.target.value)
                      if (placement && !selectedReferenceSlot) setSlotDraft(referenceDraftForPlacement(placement))
                    }}
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
                  <div className="rounded-md bg-neutral-50 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>{t("precisionStep")}</span>
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.1}
                        value={referenceStepPct}
                        onChange={(e) => setReferenceStepPct(Number.parseFloat(e.target.value || "0.5"))}
                        className="w-20 rounded border border-neutral-300 px-2 py-1 text-right"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-xs">
                      <button type="button" onClick={() => nudgeReferenceSlot(-referenceStepPct, 0)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">←</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, -referenceStepPct)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">↑</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, referenceStepPct)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">↓</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(referenceStepPct, 0)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">→</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, 0, -referenceStepPct, 0)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">{t("narrower")}</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, 0, referenceStepPct, 0)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">{t("wider")}</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, 0, 0, -referenceStepPct)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">{t("shorter")}</button>
                      <button type="button" onClick={() => nudgeReferenceSlot(0, 0, 0, referenceStepPct)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-white">{t("taller")}</button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={selectedReferenceSlot ? updateReferenceSlot : createReferenceSlot}
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                  >
                    {selectedReferenceSlot ? t("saveReferenceSlot") : t("addReferenceSlot")}
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
                {selectedPlacement.product.sku}
                {selectedPlacement.product.barcode ? ` · ${t("barcode")}: ${selectedPlacement.product.barcode}` : ""}
                {selectedPlacement.product.brandName ? ` · ${selectedPlacement.product.brandName}` : ""}
              </div>
              <div className="text-xs text-neutral-500">
                {selectedPlacement.widthMm}×{selectedPlacement.heightMm}×{selectedPlacement.depthMm} mm ·{" "}
                {selectedPlacement.facingsX * selectedPlacement.facingsY * selectedPlacement.facingsZ}{" "}
                {t("placedUnits")}
              </div>
              {selectedEffectiveSize ? (
                <div className="text-xs text-neutral-500">
                  {t("effectiveDimensions")}: {selectedEffectiveSize.widthMm}×{selectedEffectiveSize.heightMm}×
                  {selectedEffectiveSize.depthMm} mm
                </div>
              ) : null}
              {metricsByProductId.get(selectedPlacement.product.id) ? (
                <div className="grid grid-cols-2 gap-2 rounded-md bg-neutral-50 p-2 text-xs">
                  {(() => {
                    const metric = metricsByProductId.get(selectedPlacement.product.id)!
                    return (
                      <>
                        <span className="text-neutral-500">{t("abcClass")}</span>
                        <span className="text-right font-medium">{metric.abcClass}</span>
                        <span className="text-neutral-500">{t("turnoverPerDay")}</span>
                        <span className="text-right tabular-nums">{formatMoney(metric.turnoverPerDay, metric.currency)}</span>
                        <span className="text-neutral-500">{t("profitPerDay")}</span>
                        <span className="text-right tabular-nums">{formatMoney(metric.profitPerDay, metric.currency)}</span>
                        <span className="text-neutral-500">{t("stockDays")}</span>
                        <span className="text-right tabular-nums">{formatDays(metric.stockDays)}</span>
                        <span className="text-neutral-500">{t("stockQty")}</span>
                        <span className="text-right tabular-nums">{metric.stockQty == null ? "—" : metric.stockQty.toFixed(0)}</span>
                        <span className="text-neutral-500">{t("shelfShare")}</span>
                        <span className="text-right tabular-nums">{(metric.shelfShare * 100).toFixed(1)}%</span>
                        <span className="text-neutral-500">{t("currentPrice")}</span>
                        <span className="text-right tabular-nums">{formatMoney(metric.currentPrice, metric.currency)}</span>
                      </>
                    )
                  })()}
                </div>
              ) : null}
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
                <label className="block text-xs">
                  <span className="text-neutral-500">{t("moveToShelf")}</span>
                  <select
                    value={selectedPlacement.shelfId}
                    onChange={(e) => patchPlacement(selectedPlacement.id, { shelfId: e.target.value })}
                    className="block w-28 rounded border border-neutral-300 px-2 py-1"
                  >
                    {equipment.shelves.map((shelf) => (
                      <option key={shelf.id} value={shelf.id}>
                        {t("shelf")} {shelf.shelfIndex + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => patchPlacement(selectedPlacement.id, { xMm: Math.max(0, selectedPlacement.xMm - 10) })}
                  className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                >
                  {t("nudgeLeft")}
                </button>
                <button
                  type="button"
                  onClick={() => patchPlacement(selectedPlacement.id, { xMm: selectedPlacement.xMm + 10 })}
                  className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                >
                  {t("nudgeRight")}
                </button>
                <button
                  type="button"
                  onClick={() => void duplicatePlacement(selectedPlacement)}
                  className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                >
                  {t("duplicatePlacement")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const draft = referenceDraftForPlacement(selectedPlacement)
                    setSlotPlacementId(selectedPlacement.id)
                    setSlotDraft(draft)
                    if (activeReference) void createReferenceSlotForPlacement(selectedPlacement, draft)
                  }}
                  disabled={!activeReference}
                  className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                >
                  {t("createSlotFromPlacement")}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["rotationX", "rotationY", "rotationZ"] as const).map((field) => (
                  <label key={field} className="block text-xs">
                    <span className="text-neutral-500">{t(field)}</span>
                    <select
                      value={selectedPlacement[field]}
                      onChange={(e) =>
                        patchPlacement(selectedPlacement.id, { [field]: Number.parseInt(e.target.value, 10) })
                      }
                      className="block w-20 rounded border border-neutral-300 px-2 py-1"
                    >
                      {[0, 90, 180, 270].map((value) => (
                        <option key={value} value={value}>
                          {value}°
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="block text-xs">
                  <span className="text-neutral-500">{t("stackMode")}</span>
                  <select
                    value={selectedPlacement.stackMode}
                    onChange={(e) =>
                      patchPlacement(selectedPlacement.id, { stackMode: e.target.value as PlacementStackMode })
                    }
                    className="block w-32 rounded border border-neutral-300 px-2 py-1"
                  >
                    {(["NONE", "ON_TOP", "LYING"] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`stackMode_${value}` as never)}
                      </option>
                    ))}
                  </select>
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
