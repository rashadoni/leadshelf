"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

// Фото optional (решение владельца, docs/03): есть — показываем,
// нет — заглушка-«упаковка» с инициалом и цветом от бренда/названия.

const PALETTE = [
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#6366f1",
  "#14b8a6",
  "#f97316",
]

function colorFor(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

export function PhotoCell({
  productId,
  name,
  brandName,
  imageKey,
}: {
  productId: string
  name: string
  brandName: string | null
  imageKey: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPending(true)
    const form = new FormData()
    form.set("file", file)
    const res = await fetch(`/api/v1/catalog/products/${productId}/images`, {
      method: "POST",
      body: form,
    })
    setPending(false)
    if (res.ok) router.refresh()
  }

  const label = (brandName ?? name).slice(0, 1).toUpperCase()

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="block h-10 w-10 overflow-hidden rounded-md border border-neutral-200 disabled:opacity-50"
        title={name}
      >
        {imageKey ? (
          // media-proxy отдает приватные файлы — next/image тут не нужен
          <img
            src={`/api/media/${imageKey}`}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-sm font-bold text-white"
            style={{ backgroundColor: colorFor(brandName ?? name) }}
          >
            {label}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFile}
      />
    </>
  )
}
