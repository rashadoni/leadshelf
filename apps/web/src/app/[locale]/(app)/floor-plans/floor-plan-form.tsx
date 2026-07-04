"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

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
}

export function FloorPlanForm({
  stores,
  formats,
  equipment,
  planograms,
}: {
  stores: StoreOption[]
  formats: Option[]
  equipment: EquipmentOption[]
  planograms: Option[]
}) {
  const t = useTranslations("floorPlans.form")
  const router = useRouter()
  const [targetType, setTargetType] = useState<"store" | "format">("store")
  const [targetId, setTargetId] = useState(stores[0]?.id ?? formats[0]?.id ?? "")
  const [name, setName] = useState("")
  const [widthMm, setWidthMm] = useState(12000)
  const [depthMm, setDepthMm] = useState(8000)
  const [rows, setRows] = useState<EquipmentRow[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addRow() {
    const first = equipment[0]
    if (!first) return
    setRows((current) => [
      ...current,
      {
        equipmentVersionId: first.versionId,
        planogramId: "",
        label: first.name,
        xMm: 0,
        yMm: 0,
        rotationDeg: 0,
        isLocked: false,
      },
    ])
  }

  function updateRow(index: number, patch: Partial<EquipmentRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await fetch("/api/v1/floor-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        widthMm,
        depthMm,
        storeId: targetType === "store" ? targetId : null,
        formatId: targetType === "format" ? targetId : null,
        isPublished: true,
        equipment: rows.map((row) => ({
          ...row,
          planogramId: row.planogramId || null,
          label: row.label || null,
        })),
      }),
    })
    setPending(false)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${response.status}`)
      return
    }
    setName("")
    setRows([])
    router.refresh()
  }

  const targets = targetType === "store" ? stores : formats

  return (
    <form onSubmit={submit} className="mb-5 grid gap-3 border-y border-neutral-200 bg-white py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("name")}
          className="w-56 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <select
          value={targetType}
          onChange={(event) => {
            const next = event.target.value as "store" | "format"
            setTargetType(next)
            setTargetId((next === "store" ? stores[0]?.id : formats[0]?.id) ?? "")
          }}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="store">{t("store")}</option>
          <option value="format">{t("format")}</option>
        </select>
        <select
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          className="min-w-48 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {"code" in target && target.code ? `${target.name} (${target.code})` : target.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={100}
          value={widthMm}
          onChange={(event) => setWidthMm(Number.parseInt(event.target.value || "0", 10))}
          className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          type="number"
          min={100}
          value={depthMm}
          onChange={(event) => setDepthMm(Number.parseInt(event.target.value || "0", 10))}
          className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <button type="button" onClick={addRow} className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100">
          {t("addEquipment")}
        </button>
        <button disabled={pending || !targetId} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          {pending ? t("saving") : t("save")}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={row.equipmentVersionId}
            onChange={(event) => {
              const selected = equipment.find((item) => item.versionId === event.target.value)
              updateRow(index, { equipmentVersionId: event.target.value, label: selected?.name ?? row.label })
            }}
            className="min-w-52 rounded border border-neutral-300 px-2 py-1"
          >
            {equipment.map((item) => (
              <option key={item.versionId} value={item.versionId}>
                {item.name} {item.widthMm}×{item.depthMm}
              </option>
            ))}
          </select>
          <input value={row.label} onChange={(event) => updateRow(index, { label: event.target.value })} className="w-32 rounded border border-neutral-300 px-2 py-1" />
          <input type="number" value={row.xMm} onChange={(event) => updateRow(index, { xMm: Number.parseInt(event.target.value || "0", 10) })} className="w-20 rounded border border-neutral-300 px-2 py-1" />
          <input type="number" value={row.yMm} onChange={(event) => updateRow(index, { yMm: Number.parseInt(event.target.value || "0", 10) })} className="w-20 rounded border border-neutral-300 px-2 py-1" />
          <input type="number" value={row.rotationDeg} onChange={(event) => updateRow(index, { rotationDeg: Number.parseInt(event.target.value || "0", 10) })} className="w-20 rounded border border-neutral-300 px-2 py-1" />
          <select value={row.planogramId} onChange={(event) => updateRow(index, { planogramId: event.target.value })} className="min-w-44 rounded border border-neutral-300 px-2 py-1">
            <option value="">{t("noPlanogram")}</option>
            {planograms.map((planogram) => (
              <option key={planogram.id} value={planogram.id}>
                {planogram.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={row.isLocked} onChange={(event) => updateRow(index, { isLocked: event.target.checked })} />
            {t("locked")}
          </label>
          <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">
            {t("remove")}
          </button>
        </div>
      ))}
    </form>
  )
}
