"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { fetchApiResponse, formatResponseError } from "@/client/api-error"

type RefOption = { id: string; name: string; normalizedPath?: string }

export interface CatalogRefs {
  categories: RefOption[]
  brands: RefOption[]
  suppliers: RefOption[]
  manufacturers: RefOption[]
}

interface ProductInput {
  sku: string
  name: string
  unit: string
  barcode: string
  categoryId: string
  brandId: string
  supplierId: string
  manufacturerId: string
  widthMm: string
  heightMm: string
  depthMm: string
  weightG: string
  isSoftPack: boolean
  isActive?: boolean
}

const emptyProduct: ProductInput = {
  sku: "",
  name: "",
  unit: "PCS",
  barcode: "",
  categoryId: "",
  brandId: "",
  supplierId: "",
  manufacturerId: "",
  widthMm: "",
  heightMm: "",
  depthMm: "",
  weightG: "",
  isSoftPack: false,
}

function toPayload(values: ProductInput) {
  const toInt = (value: string) => (value.trim() === "" ? null : Number.parseInt(value, 10))
  const toNullable = (value: string) => (value.trim() === "" ? null : value)
  return {
    sku: values.sku,
    name: values.name,
    unit: values.unit,
    barcode: toNullable(values.barcode),
    categoryId: toNullable(values.categoryId),
    brandId: toNullable(values.brandId),
    supplierId: toNullable(values.supplierId),
    manufacturerId: toNullable(values.manufacturerId),
    widthMm: toInt(values.widthMm),
    heightMm: toInt(values.heightMm),
    depthMm: toInt(values.depthMm),
    weightG: toInt(values.weightG),
    isSoftPack: values.isSoftPack,
    ...(values.isActive === undefined ? {} : { isActive: values.isActive }),
  }
}

function RefSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: RefOption[]
  placeholder: string
}) {
  return (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-36 rounded-md border border-neutral-300 px-2 py-1 text-xs"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.normalizedPath ?? option.name}
        </option>
      ))}
    </select>
  )
}

export function ProductCreateForm({ refs }: { refs: CatalogRefs }) {
  const t = useTranslations("catalog.manage")
  const tc = useTranslations("common")
  const router = useRouter()
  const [values, setValues] = useState<ProductInput>(emptyProduct)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof ProductInput, value: string) => setValues((current) => ({ ...current, [key]: value }))
  const setBool = (key: "isSoftPack", value: boolean) => setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const response = await fetchApiResponse("/api/v1/catalog/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(values)),
    })
    setPending(false)
    if (!response.ok) {
      setError(formatResponseError(response, t("saveError"), (value) => tc("supportCode", { value })))
      return
    }
    setValues(emptyProduct)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mb-4 grid gap-2 border-y border-neutral-200 bg-white py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          required
          value={values.sku}
          onChange={(event) => set("sku", event.target.value)}
          placeholder={t("sku")}
          className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        />
        <input
          required
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder={t("name")}
          className="w-64 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        />
        <input
          value={values.barcode}
          onChange={(event) => set("barcode", event.target.value)}
          placeholder={t("barcode")}
          className="w-36 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        />
        <select
          aria-label={t("unit")}
          value={values.unit}
          onChange={(event) => set("unit", event.target.value)}
          className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        >
          {["PCS", "BOX", "KG", "L", "PACK"].map((unit) => (
            <option key={unit}>{unit}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RefSelect value={values.categoryId} onChange={(v) => set("categoryId", v)} options={refs.categories} placeholder={t("category")} />
        <RefSelect value={values.brandId} onChange={(v) => set("brandId", v)} options={refs.brands} placeholder={t("brand")} />
        <RefSelect value={values.supplierId} onChange={(v) => set("supplierId", v)} options={refs.suppliers} placeholder={t("supplier")} />
        <RefSelect value={values.manufacturerId} onChange={(v) => set("manufacturerId", v)} options={refs.manufacturers} placeholder={t("manufacturer")} />
        {["widthMm", "heightMm", "depthMm", "weightG"].map((key) => (
          <input
            key={key}
            type="number"
            min={1}
            value={values[key as keyof ProductInput] as string}
            onChange={(event) => set(key as keyof ProductInput, event.target.value)}
            placeholder={t(key)}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
          />
        ))}
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={values.isSoftPack}
            onChange={(event) => setBool("isSoftPack", event.target.checked)}
          />
          {t("isSoftPack")}
        </label>
        <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">
          {pending ? t("saving") : t("create")}
        </button>
        {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  )
}

export function ProductMetaEditor({
  productId,
  initial,
  refs,
}: {
  productId: string
  initial: ProductInput
  refs: CatalogRefs
}) {
  const t = useTranslations("catalog.manage")
  const tc = useTranslations("common")
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [values, setValues] = useState<ProductInput>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (key: keyof ProductInput, value: string) => setValues((current) => ({ ...current, [key]: value }))
  const setBool = (key: "isSoftPack" | "isActive", value: boolean) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function save(nextActive?: boolean) {
    setPending(true)
    setError(null)
    const response = await fetchApiResponse(`/api/v1/catalog/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload({ ...values, isActive: nextActive ?? values.isActive })),
    })
    setPending(false)
    if (response.ok) {
      setEditing(false)
      router.refresh()
    } else {
      setError(formatResponseError(response, t("saveError"), (value) => tc("supportCode", { value })))
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setEditing(true)} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
          {t("edit")}
        </button>
        {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
        <button
          onClick={() => save(!values.isActive)}
          disabled={pending}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
        >
          {values.isActive ? t("deactivate") : t("activate")}
        </button>
      </div>
    )
  }

  return (
    <div className="grid min-w-[520px] gap-2">
      <div className="flex flex-wrap gap-1">
        <input value={values.sku} onChange={(event) => set("sku", event.target.value)} className="w-28 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
        <input value={values.name} onChange={(event) => set("name", event.target.value)} className="w-48 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
        <input value={values.barcode} onChange={(event) => set("barcode", event.target.value)} className="w-32 rounded border border-neutral-300 px-1 py-0.5 text-xs" />
      </div>
      <div className="flex flex-wrap gap-1">
        <RefSelect value={values.categoryId} onChange={(v) => set("categoryId", v)} options={refs.categories} placeholder={t("category")} />
        <RefSelect value={values.brandId} onChange={(v) => set("brandId", v)} options={refs.brands} placeholder={t("brand")} />
        <RefSelect value={values.supplierId} onChange={(v) => set("supplierId", v)} options={refs.suppliers} placeholder={t("supplier")} />
        <RefSelect value={values.manufacturerId} onChange={(v) => set("manufacturerId", v)} options={refs.manufacturers} placeholder={t("manufacturer")} />
        <label className="flex items-center gap-1 px-1 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={values.isSoftPack}
            onChange={(event) => setBool("isSoftPack", event.target.checked)}
          />
          {t("isSoftPack")}
        </label>
        <button onClick={() => save()} disabled={pending} className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50">
          {t("save")}
        </button>
        <button onClick={() => setEditing(false)} className="rounded px-2 py-1 text-xs text-neutral-500">
          {t("cancel")}
        </button>
      </div>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
