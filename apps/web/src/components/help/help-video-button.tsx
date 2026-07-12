"use client"

/**
 * Header trigger for the help-video launcher: always visible, re-opens the
 * player even after the floating thumbnail was dismissed (the launcher
 * listens for `leadshelf:open-help-video`).
 */
import { useLocale } from "next-intl"
import { Video } from "lucide-react"

export function HelpVideoButton() {
  const locale = useLocale()
  const label = locale === "ru" ? "Видео-гид" : "Video bələdçi"

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("leadshelf:open-help-video"))}
      className="hidden items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 md:inline-flex"
    >
      <Video className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
