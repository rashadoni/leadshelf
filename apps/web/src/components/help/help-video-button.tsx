"use client"

import { useLocale } from "next-intl"
import { Video } from "lucide-react"
import { usePathname } from "@/i18n/navigation"
import { getHelpVideoForPath, normalizeHelpVideoLocale } from "@/content/help/video-assets"

export function HelpVideoButton() {
  const locale = normalizeHelpVideoLocale(useLocale())
  const pathname = usePathname()
  const entry = locale ? getHelpVideoForPath(pathname, locale) : null

  if (!entry) return null

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("leadshelf:open-help-video"))}
      className="hidden items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 md:inline-flex"
    >
      <Video className="h-3.5 w-3.5" />
      Video bələdçi
    </button>
  )
}
