"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  layoutEqualShelves,
  validateShelfAutoLayout,
  type ShelfAutoLayoutInput,
} from "@leadshelf/core"
import { EquipmentPreviewSvg } from "./equipment-preview-svg"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

interface TypeOption {
  id: string
  name: string
  kind: string
}

interface InitialData {
  templateId: string
  name: string
  typeId: string
  expectedVersionNumber: number
  isFrozen: boolean
  widthMm: number
  heightMm: number
  depthMm: number
  shelfCount: number
  shelfThicknessMm: number
  shelfDepthMm: number
  bottomOffsetMm: number
  topOffsetMm: number
  cells: Array<{ xMm: number; yMm: number; widthMm: number; heightMm: number; depthMm: number }>
  hooks: Array<{ xMm: number; yMm: number; lengthMm: number }>
}

export function EquipmentForm({
  types,
  initial,
}: {
  types: TypeOption[]
  initial?: InitialData
}) {
  const t = useTranslations("equipment.form")
  const tErr = useTranslations("equipment.errors")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()

  const [name, setName] = useState(initial?.name ?? "")
  const [typeId, setTypeId] = useState(initial?.typeId ?? types[0]?.id ?? "")
  const [geom, setGeom] = useState({
    widthMm: initial?.widthMm ?? 1200,
    heightMm: initial?.heightMm ?? 1800,
    depthMm: initial?.depthMm ?? 300,
  })
  const [fill, setFill] = useState({
    shelfCount: initial?.shelfCount ?? 5,
    shelfThicknessMm: initial?.shelfThicknessMm ?? 20,
    shelfDepthMm: initial?.shelfDepthMm ?? 300,
    bottomOffsetMm: initial?.bottomOffsetMm ?? 50,
    topOffsetMm: initial?.topOffsetMm ?? 0,
  })
  const initialCellColumns = initial?.cells.length
    ? new Set(initial.cells.map((cell) => cell.xMm)).size
    : 0
  const initialCellRows = initial?.cells.length ? new Set(initial.cells.map((cell) => cell.yMm)).size : 0
  const [cells, setCells] = useState({ columns: initialCellColumns, rows: initialCellRows })
  const [hooks, setHooks] = useState({
    count: initial?.hooks.length ?? 0,
    yMm: initial?.hooks[0]?.yMm ?? Math.round((initial?.heightMm ?? 1800) * 0.65),
    lengthMm: initial?.hooks[0]?.lengthMm ?? 180,
  })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const layoutInput: ShelfAutoLayoutInput = {
    equipmentHeightMm: geom.heightMm,
    equipmentDepthMm: geom.depthMm,
    shelfCount: fill.shelfCount,
    shelfThicknessMm: fill.shelfThicknessMm,
    shelfDepthMm: fill.shelfDepthMm,
    topOffsetMm: fill.topOffsetMm,
    bottomOffsetMm: fill.bottomOffsetMm,
  }
  const issues = useMemo(() => validateShelfAutoLayout(layoutInput), [layoutInput])
  const layout = useMemo(
    () => (issues.length === 0 ? layoutEqualShelves(layoutInput) : null),
    [issues, layoutInput],
  )
  const generatedCells = useMemo(() => {
    if (cells.columns <= 0 || cells.rows <= 0) return []
    const width = Math.floor(geom.widthMm / cells.columns)
    const height = Math.floor(geom.heightMm / cells.rows)
    return Array.from({ length: cells.columns * cells.rows }, (_, index) => {
      const col = index % cells.columns
      const row = Math.floor(index / cells.columns)
      return {
        xMm: col * width,
        yMm: row * height,
        widthMm: col === cells.columns - 1 ? geom.widthMm - col * width : width,
        heightMm: row === cells.rows - 1 ? geom.heightMm - row * height : height,
        depthMm: geom.depthMm,
      }
    })
  }, [cells.columns, cells.rows, geom.depthMm, geom.heightMm, geom.widthMm])
  const generatedHooks = useMemo(() => {
    if (hooks.count <= 0) return []
    const step = geom.widthMm / (hooks.count + 1)
    return Array.from({ length: hooks.count }, (_, index) => ({
      xMm: Math.round(step * (index + 1)),
      yMm: hooks.yMm,
      lengthMm: hooks.lengthMm,
    }))
  }, [geom.widthMm, hooks.count, hooks.lengthMm, hooks.yMm])

  async function save() {
    if (!layout) return
    setPending(true)
    setMessage(null)
    const shelves = layout.shelves
    const res = initial
      ? await fetchApiResponse(`/api/v1/equipment/templates/${initial.templateId}/version`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersionNumber: initial.expectedVersionNumber,
            ...geom,
            shelves,
            cells: generatedCells,
            hooks: generatedHooks,
          }),
        })
      : await fetchApiResponse("/api/v1/equipment/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, typeId, ...geom, shelves, cells: generatedCells, hooks: generatedHooks }),
        })
    setPending(false)
    if (res.ok) {
      setMessage(t("saved"))
      if (!initial) {
        const body = await res.json()
        window.location.assign(`/${locale}/equipment-library/${body.templateId}`)
      } else {
        router.refresh()
      }
    } else if (res.status === 409) {
      setMessage(t("conflict"))
    } else {
      const body = await res.json().catch(() => ({}))
      setMessage(formatResponseError(
        res,
        body.error ?? `HTTP ${res.status}`,
        (value) => tc("supportCode", { value }),
      ))
    }
  }

  async function copy() {
    if (!initial) return
    setPending(true)
    const res = await fetchApiResponse(`/api/v1/equipment/templates/${initial.templateId}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${initial.name} copy` }),
    })
    setPending(false)
    if (res.ok) {
      const body = await res.json()
      window.location.assign(`/${locale}/equipment-library/${body.templateId}`)
    } else {
      setMessage(formatResponseError(res, tc("actionFailed"), (value) => tc("supportCode", { value })))
    }
  }

  const numField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    props: { min?: number } = {},
  ) => (
    <label className="block space-y-1 text-sm">
      <span className="text-neutral-600">{label}</span>
      <input
        type="number"
        min={props.min ?? 1}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value || "0", 10))}
        className="block w-32 rounded-md border border-neutral-300 px-2 py-1.5"
      />
    </label>
  )

  return (
    <div className="flex flex-wrap gap-8">
      <div className="min-w-72 flex-1 space-y-5">
        {!initial && (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-neutral-600">{t("name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="block w-full max-w-md rounded-md border border-neutral-300 px-3 py-1.5"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-neutral-600">{t("type")}</span>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="block rounded-md border border-neutral-300 px-3 py-1.5"
              >
                {types.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="flex flex-wrap gap-3">
          {numField(t("width"), geom.widthMm, (n) => setGeom((g) => ({ ...g, widthMm: n })))}
          {numField(t("height"), geom.heightMm, (n) => setGeom((g) => ({ ...g, heightMm: n })))}
          {numField(t("depth"), geom.depthMm, (n) => setGeom((g) => ({ ...g, depthMm: n })))}
        </div>

        <fieldset className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-medium">{t("fillTool")}</legend>
          <div className="flex flex-wrap gap-3">
            {numField(t("shelfCount"), fill.shelfCount, (n) => setFill((f) => ({ ...f, shelfCount: n })))}
            {numField(t("shelfThickness"), fill.shelfThicknessMm, (n) =>
              setFill((f) => ({ ...f, shelfThicknessMm: n })),
            )}
            {numField(t("shelfDepth"), fill.shelfDepthMm, (n) =>
              setFill((f) => ({ ...f, shelfDepthMm: n })),
            )}
            {numField(t("topOffset"), fill.topOffsetMm, (n) => setFill((f) => ({ ...f, topOffsetMm: n })), { min: 0 })}
            {numField(t("bottomOffset"), fill.bottomOffsetMm, (n) =>
              setFill((f) => ({ ...f, bottomOffsetMm: n })), { min: 0 })}
          </div>
          {layout && (
            <p className="text-sm text-neutral-500">
              {t("rowGap")}: <b>{layout.rowGapMm} mm</b>
            </p>
          )}
          {issues.map((i) => (
            <p key={i.code + (i.field ?? "")} className="text-sm text-red-600">
              {tErr(i.code)}
            </p>
          ))}
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-medium">{t("cellsHooks")}</legend>
          <div className="flex flex-wrap gap-3">
            {numField(t("cellColumns"), cells.columns, (n) => setCells((c) => ({ ...c, columns: n })), { min: 0 })}
            {numField(t("cellRows"), cells.rows, (n) => setCells((c) => ({ ...c, rows: n })), { min: 0 })}
            {numField(t("hookCount"), hooks.count, (n) => setHooks((h) => ({ ...h, count: n })), { min: 0 })}
            {numField(t("hookY"), hooks.yMm, (n) => setHooks((h) => ({ ...h, yMm: n })), { min: 0 })}
            {numField(t("hookLength"), hooks.lengthMm, (n) => setHooks((h) => ({ ...h, lengthMm: n })), { min: 1 })}
          </div>
          <p className="text-xs text-neutral-500">
            {generatedCells.length} cells · {generatedHooks.length} hooks
          </p>
        </fieldset>

        {initial?.isFrozen && <p className="text-sm text-amber-600">{t("frozenHint")}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={pending || issues.length > 0 || (!initial && !name.trim())}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? t("saving") : t("save")}
          </button>
          {initial && (
            <button
              onClick={copy}
              disabled={pending}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            >
              {t("copy")}
            </button>
          )}
          {message && <span className="text-sm text-neutral-600">{message}</span>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-neutral-600">{t("preview")}</p>
        <EquipmentPreviewSvg
          widthMm={geom.widthMm}
          heightMm={geom.heightMm}
          shelves={layout?.shelves ?? []}
          cells={generatedCells}
          hooks={generatedHooks}
        />
        <p className="text-center text-xs text-neutral-400">
          {geom.widthMm}×{geom.heightMm}×{geom.depthMm} mm
        </p>
      </div>
    </div>
  )
}
