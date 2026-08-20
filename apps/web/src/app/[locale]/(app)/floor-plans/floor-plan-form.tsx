"use client"

import {
  findAvailableFloorPlanPosition,
  getRotatedFootprint,
  normalizeQuarterTurn,
  snapFloorPlanCoordinate,
  validateFloorPlanLayout,
  type FloorPlanPlacementGeometry,
} from "@leadshelf/core"
import { Lock, RotateCw, Trash2, Unlock, ZoomIn, ZoomOut } from "lucide-react"
import { useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

interface Option {
  id: string
  name: string
}

interface StoreOption extends Option {
  code: string | null
}

interface EquipmentOption extends Option {
  versionId: string
  widthMm: number
  depthMm: number
}

interface EquipmentRow {
  equipmentVersionId: string
  planogramId: string
  label: string
  xMm: number
  yMm: number
  rotationDeg: number
  isLocked: boolean
  widthMm: number
  depthMm: number
}

interface FloorPlanInitial {
  name: string
  targetType: "store" | "format"
  targetId: string
  widthMm: number
  depthMm: number
  equipment: EquipmentRow[]
}

interface DragState {
  index: number
  pointerId: number
  offsetX: number
  offsetY: number
}

const GRID_STEP_MM = 100

function toGeometry(row: EquipmentRow): FloorPlanPlacementGeometry {
  return {
    xMm: row.xMm,
    yMm: row.yMm,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    rotationDeg: row.rotationDeg,
  }
}

export function FloorPlanForm({
  floorPlanId,
  initial,
  variant = "create",
  stores,
  formats,
  equipment,
  planograms,
}: {
  floorPlanId?: string
  initial?: FloorPlanInitial
  variant?: "create" | "inline"
  stores: StoreOption[]
  formats: Option[]
  equipment: EquipmentOption[]
  planograms: Option[]
}) {
  const t = useTranslations("floorPlans.form")
  const tc = useTranslations("common")
  const router = useRouter()
  const svgRef = useRef<SVGSVGElement>(null)
  const [targetType, setTargetType] = useState<"store" | "format">(initial?.targetType ?? "store")
  const [targetId, setTargetId] = useState(initial?.targetId ?? stores[0]?.id ?? formats[0]?.id ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [widthMm, setWidthMm] = useState(initial?.widthMm ?? 12000)
  const [depthMm, setDepthMm] = useState(initial?.depthMm ?? 8000)
  const [rows, setRows] = useState<EquipmentRow[]>(initial?.equipment ?? [])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initial?.equipment.length ? 0 : null)
  const [libraryVersionId, setLibraryVersionId] = useState(equipment[0]?.versionId ?? "")
  const [zoom, setZoom] = useState(100)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placementError, setPlacementError] = useState<string | null>(null)

  const layoutIssues = useMemo(
    () => validateFloorPlanLayout({ widthMm, depthMm }, rows.map(toGeometry)),
    [depthMm, rows, widthMm],
  )
  const layoutErrorText = layoutIssues[0] ? placementIssueText(layoutIssues[0].type) : null
  const selected = selectedIndex === null ? null : rows[selectedIndex] ?? null

  function placementIssueText(type: "outside_bounds" | "collision") {
    return type === "outside_bounds" ? t("outsideBounds") : t("collision")
  }

  function addRow() {
    const item = equipment.find((candidate) => candidate.versionId === libraryVersionId) ?? equipment[0]
    if (!item) return
    const placement = { widthMm: item.widthMm, depthMm: item.depthMm, rotationDeg: 0 }
    const position = findAvailableFloorPlanPosition(
      { widthMm, depthMm },
      placement,
      rows.map(toGeometry),
      GRID_STEP_MM,
    )
    if (!position) {
      setPlacementError(t("noFreeSpace"))
      return
    }
    setRows((current) => [
      ...current,
      {
        equipmentVersionId: item.versionId,
        planogramId: "",
        label: item.name,
        ...position,
        rotationDeg: 0,
        isLocked: false,
        widthMm: item.widthMm,
        depthMm: item.depthMm,
      },
    ])
    setSelectedIndex(rows.length)
    setPlacementError(null)
  }

  function updateRow(index: number, patch: Partial<EquipmentRow>, validate = false): boolean {
    const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    if (validate) {
      const issue = validateFloorPlanLayout({ widthMm, depthMm }, nextRows.map(toGeometry)).find(
        (candidate) => candidate.index === index || candidate.conflictingIndex === index,
      )
      if (issue) {
        setPlacementError(placementIssueText(issue.type))
        return false
      }
    }
    setRows(nextRows)
    setPlacementError(null)
    return true
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
    setSelectedIndex((current) => {
      if (current === null) return null
      if (current === index) return null
      return current > index ? current - 1 : current
    })
    setPlacementError(null)
  }

  function rotateSelected() {
    if (selectedIndex === null || !selected || selected.isLocked) return
    updateRow(selectedIndex, { rotationDeg: normalizeQuarterTurn(selected.rotationDeg + 90) }, true)
  }

  function roomPoint(event: { clientX: number; clientY: number }) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      xMm: ((event.clientX - rect.left) / rect.width) * widthMm,
      yMm: ((event.clientY - rect.top) / rect.height) * depthMm,
    }
  }

  function startDrag(index: number, event: ReactPointerEvent<SVGGElement>) {
    const row = rows[index]
    setSelectedIndex(index)
    if (!row) return
    if (row.isLocked) return
    const point = roomPoint(event)
    if (!point) return
    event.preventDefault()
    svgRef.current?.setPointerCapture(event.pointerId)
    setDrag({
      index,
      pointerId: event.pointerId,
      offsetX: point.xMm - row.xMm,
      offsetY: point.yMm - row.yMm,
    })
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = roomPoint(event)
    if (!point) return
    const row = rows[drag.index]
    if (!row) return
    const footprint = getRotatedFootprint(row.widthMm, row.depthMm, row.rotationDeg)
    const xMm = Math.min(
      Math.max(0, widthMm - footprint.widthMm),
      snapFloorPlanCoordinate(point.xMm - drag.offsetX, GRID_STEP_MM),
    )
    const yMm = Math.min(
      Math.max(0, depthMm - footprint.depthMm),
      snapFloorPlanCoordinate(point.yMm - drag.offsetY, GRID_STEP_MM),
    )
    updateRow(drag.index, { xMm, yMm }, true)
  }

  function finishDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (layoutErrorText) {
      setPlacementError(layoutErrorText)
      return
    }
    setPending(true)
    setError(null)
    const response = await fetchApiResponse(floorPlanId ? `/api/v1/floor-plans/${floorPlanId}` : "/api/v1/floor-plans", {
      method: floorPlanId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        widthMm,
        depthMm,
        storeId: targetType === "store" ? targetId : null,
        formatId: targetType === "format" ? targetId : null,
        isPublished: true,
        equipment: rows.map((row) => ({
          equipmentVersionId: row.equipmentVersionId,
          xMm: row.xMm,
          yMm: row.yMm,
          isLocked: row.isLocked,
          rotationDeg: normalizeQuarterTurn(row.rotationDeg),
          planogramId: row.planogramId || null,
          label: row.label || null,
        })),
      }),
    })
    setPending(false)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(formatResponseError(
        response,
        body.error ?? `HTTP ${response.status}`,
        (value) => tc("supportCode", { value }),
      ))
      return
    }
    if (!floorPlanId) {
      setName("")
      setRows([])
      setSelectedIndex(null)
    }
    router.refresh()
  }

  const targets = targetType === "store" ? stores : formats
  const formClassName =
    variant === "inline"
      ? "grid gap-4 bg-white p-4"
      : "grid gap-4 border-t border-neutral-200 bg-white p-4"

  return (
    <form onSubmit={submit} className={formClassName} data-testid="floor-plan-editor">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1.4fr)_9rem_minmax(13rem,1fr)_8rem_8rem_auto]">
        <label className="grid gap-1 text-xs font-medium text-neutral-600">
          {t("name")}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("name")}
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-neutral-600">
          {t("targetType")}
          <select
            value={targetType}
            onChange={(event) => {
              const next = event.target.value as "store" | "format"
              setTargetType(next)
              setTargetId((next === "store" ? stores[0]?.id : formats[0]?.id) ?? "")
            }}
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
          >
            <option value="store">{t("store")}</option>
            <option value="format">{t("format")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-neutral-600">
          {t("target")}
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {"code" in target && target.code ? `${target.name} (${target.code})` : target.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-neutral-600">
          {t("roomWidth")}
          <input
            type="number"
            min={100}
            value={widthMm}
            onChange={(event) => setWidthMm(Number.parseInt(event.target.value || "0", 10))}
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-neutral-600">
          {t("roomDepth")}
          <input
            type="number"
            min={100}
            value={depthMm}
            onChange={(event) => setDepthMm(Number.parseInt(event.target.value || "0", 10))}
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
          />
        </label>
        <div className="flex items-end">
          <button
            disabled={pending || !targetId || layoutIssues.length > 0}
            className="h-10 w-full rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? t("saving") : floorPlanId ? t("update") : t("save")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <select
                aria-label={t("equipmentLibrary")}
                value={libraryVersionId}
                onChange={(event) => setLibraryVersionId(event.target.value)}
                className="min-w-44 max-w-sm flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
              >
                {equipment.map((item) => (
                  <option key={item.versionId} value={item.versionId}>
                    {item.name} · {item.widthMm}×{item.depthMm} mm
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addRow}
                disabled={!libraryVersionId}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t("addEquipment")}
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1">
              <button type="button" aria-label={t("zoomOut")} onClick={() => setZoom((value) => Math.max(60, value - 20))} className="rounded p-1.5 hover:bg-white">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-xs tabular-nums text-neutral-600">{zoom}%</span>
              <button type="button" aria-label={t("zoomIn")} onClick={() => setZoom((value) => Math.min(200, value + 20))} className="rounded p-1.5 hover:bg-white">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto p-5" data-testid="floor-plan-canvas-scroll">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${Math.max(widthMm, 100)} ${Math.max(depthMm, 100)}`}
              role="application"
              aria-label={t("canvasLabel")}
              data-testid="floor-plan-canvas"
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelectedIndex(null)
              }}
              className="block touch-none bg-white shadow-sm"
              style={{ width: `${zoom}%`, aspectRatio: `${Math.max(widthMm, 100)} / ${Math.max(depthMm, 100)}` }}
            >
              <defs>
                <pattern id={`floor-grid-minor-${floorPlanId ?? "new"}`} width="100" height="100" patternUnits="userSpaceOnUse">
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                </pattern>
                <pattern id={`floor-grid-major-${floorPlanId ?? "new"}`} width="500" height="500" patternUnits="userSpaceOnUse">
                  <rect width="500" height="500" fill={`url(#floor-grid-minor-${floorPlanId ?? "new"})`} />
                  <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#dbe3ec" strokeWidth="14" />
                </pattern>
              </defs>
              <rect width={widthMm} height={depthMm} fill={`url(#floor-grid-major-${floorPlanId ?? "new"})`} />
              <rect x="35" y="35" width={Math.max(0, widthMm - 70)} height={Math.max(0, depthMm - 70)} fill="none" stroke="#334155" strokeWidth="70" />
              {rows.map((row, index) => {
                const size = getRotatedFootprint(row.widthMm, row.depthMm, row.rotationDeg)
                const isSelected = selectedIndex === index
                const hasIssue = layoutIssues.some((issue) => issue.index === index || issue.conflictingIndex === index)
                const label = row.label || equipment.find((item) => item.versionId === row.equipmentVersionId)?.name || t("equipmentFallback")
                return (
                  <g
                    key={`${row.equipmentVersionId}-${index}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${label}, ${row.xMm} × ${row.yMm} mm`}
                    data-testid="floor-plan-equipment"
                    data-equipment-index={index}
                    data-x-mm={row.xMm}
                    data-y-mm={row.yMm}
                    data-rotation-deg={normalizeQuarterTurn(row.rotationDeg)}
                    transform={`translate(${row.xMm} ${row.yMm})`}
                    onPointerDown={(event) => startDrag(index, event)}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedIndex(index)
                    }}
                    onKeyDown={(event) => {
                      if (row.isLocked) return
                      const movement = {
                        ArrowLeft: { xMm: row.xMm - GRID_STEP_MM, yMm: row.yMm },
                        ArrowRight: { xMm: row.xMm + GRID_STEP_MM, yMm: row.yMm },
                        ArrowUp: { xMm: row.xMm, yMm: row.yMm - GRID_STEP_MM },
                        ArrowDown: { xMm: row.xMm, yMm: row.yMm + GRID_STEP_MM },
                      }[event.key]
                      if (!movement) return
                      event.preventDefault()
                      setSelectedIndex(index)
                      updateRow(index, movement, true)
                    }}
                    className={row.isLocked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
                  >
                    <rect
                      width={size.widthMm}
                      height={size.depthMm}
                      rx={Math.min(80, size.depthMm / 5)}
                      fill={hasIssue ? "#fee2e2" : row.planogramId ? "#dbeafe" : "#e2e8f0"}
                      stroke={hasIssue ? "#dc2626" : isSelected ? "#1d4ed8" : "#64748b"}
                      strokeWidth={isSelected ? 45 : 24}
                    />
                    <line x1={size.widthMm * 0.15} y1={size.depthMm / 2} x2={size.widthMm * 0.85} y2={size.depthMm / 2} stroke="#64748b" strokeWidth="18" />
                    <text
                      x={size.widthMm / 2}
                      y={Math.max(120, size.depthMm / 2 - 35)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(180, Math.max(90, size.depthMm * 0.28))}
                      fontWeight="600"
                      fill="#0f172a"
                      textLength={Math.max(80, size.widthMm - 120)}
                      lengthAdjust="spacingAndGlyphs"
                    >
                      {label.slice(0, 32)}
                    </text>
                    <text
                      x={size.widthMm / 2}
                      y={Math.min(size.depthMm - 70, size.depthMm / 2 + 105)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(130, Math.max(75, size.depthMm * 0.2))}
                      fill="#475569"
                    >
                      {index + 1} · {size.widthMm}×{size.depthMm}
                    </text>
                    {row.isLocked ? (
                      <circle cx={Math.max(90, size.widthMm - 90)} cy="90" r="55" fill="#334155" />
                    ) : null}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500">
            <span>{t("canvasHint")}</span>
            <span>{widthMm}×{depthMm} mm · {t("equipmentCount", { count: rows.length })}</span>
          </div>
        </section>

        <aside className="rounded-xl border border-neutral-200 bg-white p-4" data-testid="floor-plan-properties">
          <h3 className="font-semibold text-neutral-900">{t("properties")}</h3>
          {!selected || selectedIndex === null ? (
            <p className="mt-3 text-sm leading-6 text-neutral-500">{t("selectEquipmentHint")}</p>
          ) : (
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                {t("equipment")}
                <select
                  value={selected.equipmentVersionId}
                  onChange={(event) => {
                    const item = equipment.find((candidate) => candidate.versionId === event.target.value)
                    if (!item) return
                    updateRow(selectedIndex, {
                      equipmentVersionId: item.versionId,
                      label: item.name,
                      widthMm: item.widthMm,
                      depthMm: item.depthMm,
                    }, true)
                  }}
                  disabled={selected.isLocked}
                  className="h-10 rounded-md border border-neutral-300 px-3 text-sm disabled:bg-neutral-100"
                >
                  {equipment.map((item) => (
                    <option key={item.versionId} value={item.versionId}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                {t("label")}
                <input value={selected.label} onChange={(event) => updateRow(selectedIndex, { label: event.target.value })} disabled={selected.isLocked} className="h-10 rounded-md border border-neutral-300 px-3 text-sm disabled:bg-neutral-100" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-xs font-medium text-neutral-600">
                  {t("positionX")}
                  <input type="number" min={0} step={GRID_STEP_MM} value={selected.xMm} onChange={(event) => updateRow(selectedIndex, { xMm: Number.parseInt(event.target.value || "0", 10) }, true)} disabled={selected.isLocked} className="h-10 rounded-md border border-neutral-300 px-3 text-sm disabled:bg-neutral-100" />
                </label>
                <label className="grid gap-1 text-xs font-medium text-neutral-600">
                  {t("positionY")}
                  <input type="number" min={0} step={GRID_STEP_MM} value={selected.yMm} onChange={(event) => updateRow(selectedIndex, { yMm: Number.parseInt(event.target.value || "0", 10) }, true)} disabled={selected.isLocked} className="h-10 rounded-md border border-neutral-300 px-3 text-sm disabled:bg-neutral-100" />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                {t("planogram")}
                <select value={selected.planogramId} onChange={(event) => updateRow(selectedIndex, { planogramId: event.target.value })} disabled={selected.isLocked} className="h-10 rounded-md border border-neutral-300 px-3 text-sm disabled:bg-neutral-100">
                  <option value="">{t("noPlanogram")}</option>
                  {planograms.map((planogram) => <option key={planogram.id} value={planogram.id}>{planogram.name}</option>)}
                </select>
              </label>
              <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                <div className="flex justify-between"><span>{t("size")}</span><strong>{getRotatedFootprint(selected.widthMm, selected.depthMm, selected.rotationDeg).widthMm}×{getRotatedFootprint(selected.widthMm, selected.depthMm, selected.rotationDeg).depthMm} mm</strong></div>
                <div className="mt-2 flex justify-between"><span>{t("rotation")}</span><strong>{normalizeQuarterTurn(selected.rotationDeg)}°</strong></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={rotateSelected} disabled={selected.isLocked} className="flex items-center justify-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"><RotateCw className="h-4 w-4" />{t("rotate")}</button>
                <button type="button" onClick={() => updateRow(selectedIndex, { isLocked: !selected.isLocked })} className="flex items-center justify-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
                  {selected.isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  {selected.isLocked ? t("unlock") : t("lock")}
                </button>
              </div>
              <button type="button" onClick={() => removeRow(selectedIndex)} disabled={selected.isLocked} className="flex items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" />{t("remove")}</button>
            </div>
          )}
        </aside>
      </div>

      {(placementError || layoutErrorText) && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {placementError ?? layoutErrorText}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
