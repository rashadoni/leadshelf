"use client"

import { useLocale } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"

export function LocaleSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="flex gap-1">
      {routing.locales.map((l) => (
        <button
          key={l}
          onClick={() => router.replace(pathname, { locale: l })}
          className={`rounded px-2 py-1 text-xs uppercase ${
            l === locale ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
