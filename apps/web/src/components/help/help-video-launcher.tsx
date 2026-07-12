"use client"

/**
 * Floating help-video launcher (ported from leaddrive-v2, trimmed to
 * LeadShelf's plain-tailwind style and az/ru locales).
 *
 * Shows a small poster thumbnail bottom-right; click → expanded player with
 * the section's guide video served by /api/help-videos. Dismissal is stored
 * per slug+locale in localStorage. The header button (help-video-button.tsx)
 * dispatches `leadshelf:open-help-video` to (re)open it even when dismissed.
 *
 * v1: every section maps to the "overview" full-cycle film; extend
 * VIDEO_BY_SECTION as per-section videos are recorded.
 */
import { useEffect, useState } from "react"
import { useLocale } from "next-intl"
import { Minimize2, Play, Video, X } from "lucide-react"
import { usePathname } from "@/i18n/navigation"

const VIDEO_BY_SECTION: Record<string, string> = {
  // "/catalog": "catalog", …per-section films land here later
}
const DEFAULT_SLUG = "overview"

const LABELS = {
  az: {
    eyebrow: "Video bələdçi",
    title: "LeadShelf — tam dövrə turu",
    subtitle: "Lazım olanda açın — iş ekranını örtmür.",
    play: "Videonu aç",
    minimize: "Kiçilt",
    close: "Bağla",
    dismissTitle: "Videonu bir daha göstərməyək?",
    dismissBody: "«Bəli» seçsəniz, videonu yuxarıdakı «Video bələdçi» düyməsi ilə yenidən aça bilərsiniz.",
    dismissYes: "Bəli",
    dismissNo: "Xeyr",
  },
  ru: {
    eyebrow: "Видео-гид",
    title: "LeadShelf — тур по полному циклу",
    subtitle: "Откройте при необходимости — рабочий экран не перекрывается.",
    play: "Открыть видео",
    minimize: "Свернуть",
    close: "Закрыть",
    dismissTitle: "Больше не показывать видео?",
    dismissBody: "Если выбрать «Да», видео всегда можно открыть кнопкой «Видео-гид» в шапке.",
    dismissYes: "Да",
    dismissNo: "Нет",
  },
} as const

type VideoMode = "expanded" | "thumbnail" | "hidden"

function slugForPath(pathname: string | null): string {
  if (!pathname) return DEFAULT_SLUG
  const seg = `/${pathname.split("/").filter(Boolean)[0] ?? ""}`
  return VIDEO_BY_SECTION[seg] ?? DEFAULT_SLUG
}

function storageKey(slug: string, locale: string) {
  return `ls_help_video:v1:${slug}:${locale}`
}

export function HelpVideoLauncher() {
  const pathname = usePathname()
  const rawLocale = useLocale()
  const locale = rawLocale === "ru" ? "ru" : "az"
  const labels = LABELS[locale]
  const slug = slugForPath(pathname)
  const key = storageKey(slug, locale)

  // hidden until mounted: localStorage is browser-only, SSR must not flash.
  const [mode, setMode] = useState<VideoMode>("hidden")
  const [confirming, setConfirming] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(key) === "dismissed"
      setMode(dismissed ? "hidden" : "thumbnail")
    } catch {
      setMode("thumbnail")
    }
    setConfirming(false)
    setVideoFailed(false)
    setPosterFailed(false)
  }, [key])

  useEffect(() => {
    function handleOpen() {
      setConfirming(false)
      setMode("expanded")
    }
    window.addEventListener("leadshelf:open-help-video", handleOpen)
    return () => window.removeEventListener("leadshelf:open-help-video", handleOpen)
  }, [])

  if (mode === "hidden") return null

  const videoSrc = `/api/help-videos/${slug}.${locale}.VOICE.mp4`
  const posterSrc = `/api/help-videos/${slug}.${locale}.poster.jpg`

  function dismiss() {
    try {
      window.localStorage.setItem(key, "dismissed")
    } catch {}
    setConfirming(false)
    setMode("hidden")
  }

  function hideForNow() {
    setConfirming(false)
    setMode("hidden")
  }

  const closeConfirmation = (
    <div className="border-t border-neutral-200 bg-neutral-50 px-3 py-3">
      <p className="text-xs font-semibold text-neutral-900">{labels.dismissTitle}</p>
      <p className="mt-1 text-[11px] leading-4 text-neutral-500">{labels.dismissBody}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={hideForNow}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
        >
          {labels.dismissNo}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
        >
          {labels.dismissYes}
        </button>
      </div>
    </div>
  )

  if (mode === "thumbnail") {
    return (
      <aside className="fixed bottom-4 right-4 z-50 w-[min(220px,calc(100vw-2rem))]">
        <div className="group overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
          <button
            type="button"
            onClick={() => setMode("expanded")}
            className="relative block aspect-video w-full overflow-hidden text-left"
            aria-label={labels.play}
          >
            {posterFailed ? (
              <span className="flex h-full w-full items-center justify-center bg-neutral-100 text-indigo-600">
                <Video className="h-7 w-7" />
              </span>
            ) : (
              <img
                src={posterSrc}
                alt=""
                onError={() => setPosterFailed(true)}
                className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
              />
            )}
            <span className="absolute inset-0 bg-black/20" aria-hidden="true" />
            <span className="absolute left-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-sm">
              <Play className="h-4 w-4 fill-current" />
            </span>
          </button>
          {confirming ? (
            closeConfirmation
          ) : (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-4">{labels.eyebrow}</p>
                <p className="line-clamp-2 break-words text-[11px] leading-4 text-neutral-500">{labels.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label={labels.close}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>
    )
  }

  return (
    <aside className="fixed bottom-5 right-5 z-50 w-[min(640px,calc(100vw-2rem))]">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-indigo-600">
              <Video className="h-3.5 w-3.5" />
              <span>{labels.eyebrow}</span>
            </div>
            <h2 className="line-clamp-2 break-words text-sm font-semibold leading-5">{labels.title}</h2>
            <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{labels.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMode("thumbnail")}
              aria-label={labels.minimize}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={labels.close}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {confirming ? closeConfirmation : null}
        {videoFailed ? (
          <div className="flex aspect-video max-h-[60vh] w-full items-center justify-center bg-neutral-100 px-6 text-center text-sm text-neutral-500">
            {locale === "az" ? "Video hələ yüklənməyib." : "Видео ещё не загружено."}
          </div>
        ) : (
          <video
            key={`${slug}.${locale}`}
            className="aspect-video max-h-[60vh] w-full bg-neutral-950"
            controls
            playsInline
            preload="metadata"
            poster={posterFailed ? undefined : posterSrc}
            src={videoSrc}
            onError={() => setVideoFailed(true)}
          />
        )}
      </div>
    </aside>
  )
}
