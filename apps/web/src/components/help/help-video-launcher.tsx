"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale } from "next-intl"
import { Minimize2, Play, Video, X } from "lucide-react"
import { usePathname } from "@/i18n/navigation"
import {
  getHelpVideoAsset,
  getHelpVideoForPath,
  normalizeHelpVideoLocale,
} from "@/content/help/video-assets"

type VideoMode = "expanded" | "thumbnail" | "hidden"

const LABELS = {
  az: {
    eyebrow: "Video bələdçi",
    subtitle: "Real addımları və nümunə məlumatları videoda izləyin.",
    play: "Videonu aç",
    minimize: "Kiçilt",
    close: "Bağla",
    unavailable: "Video hazırda açıla bilmir.",
  },
  ru: {
    eyebrow: "Видео-гид на азербайджанском",
    subtitle: "Посмотрите реальные действия и демонстрационные данные.",
    play: "Открыть видео",
    minimize: "Свернуть",
    close: "Закрыть",
    unavailable: "Видео сейчас недоступно.",
  },
} as const

function storageKey(slug: string) {
  return `ls_help_video:v2:${slug}:az`
}

export function HelpVideoLauncher() {
  const pathname = usePathname()
  const uiLocale = useLocale()
  const labels = uiLocale === "ru" ? LABELS.ru : LABELS.az
  const locale = normalizeHelpVideoLocale(uiLocale)
  const entry = useMemo(
    () => (locale ? getHelpVideoForPath(pathname, locale) : null),
    [locale, pathname],
  )
  const assets = entry && locale ? getHelpVideoAsset(entry, locale) : null
  const title = uiLocale === "ru" ? entry?.titleRu ?? entry?.title : entry?.title
  const key = entry?.dismissible === false ? null : entry ? storageKey(entry.slug) : null
  const [mode, setMode] = useState<VideoMode>("hidden")
  const [posterFailed, setPosterFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    if (entry?.dismissible === false) {
      setMode("thumbnail")
      setPosterFailed(false)
      setVideoFailed(false)
      return
    }
    if (!key) {
      setMode("hidden")
      return
    }
    try {
      setMode(window.localStorage.getItem(key) === "dismissed" ? "hidden" : "thumbnail")
    } catch {
      setMode("thumbnail")
    }
    setPosterFailed(false)
    setVideoFailed(false)
  }, [entry?.dismissible, key])

  useEffect(() => {
    function handleOpen() {
      if (entry) setMode("expanded")
    }
    window.addEventListener("leadshelf:open-help-video", handleOpen)
    return () => window.removeEventListener("leadshelf:open-help-video", handleOpen)
  }, [entry])

  if (!entry || !assets || mode === "hidden") return null

  function close() {
    if (key) {
      try {
        window.localStorage.setItem(key, "dismissed")
      } catch {}
    }
    setMode("hidden")
  }

  if (mode === "thumbnail") {
    return (
      <aside className="mb-4" data-help-video-widget>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 p-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setMode("expanded")}
              className="group relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-100 text-left sm:w-40"
              aria-label={labels.play}
            >
              {posterFailed ? (
                <span className="flex h-full w-full items-center justify-center text-indigo-600">
                  <Video className="h-6 w-6" />
                </span>
              ) : (
                <img
                  src={assets.posterSrc}
                  alt=""
                  className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                  onError={() => setPosterFailed(true)}
                />
              )}
              <span className="absolute inset-0 bg-black/15 transition group-hover:bg-black/25" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-neutral-950 shadow-sm">
                  <Play className="h-4 w-4 fill-current" />
                </span>
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600">
                <Video className="h-3.5 w-3.5" />
                <span>{labels.eyebrow}</span>
              </div>
              <p className="mt-0.5 truncate text-sm font-semibold">{title}</p>
              <p className="mt-0.5 hidden truncate text-xs text-neutral-500 sm:block">{labels.subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setMode("expanded")}
                className="hidden h-8 items-center gap-1.5 rounded-md border border-neutral-300 px-3 text-xs font-medium hover:bg-neutral-50 sm:inline-flex"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {labels.play}
              </button>
              {entry.dismissible !== false ? (
                <button
                  type="button"
                  onClick={close}
                  aria-label={labels.close}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${labels.eyebrow}: ${title}`}
      onClick={() => setMode("thumbnail")}
    >
      <div
        className="w-[min(960px,100%)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
              <Video className="h-3.5 w-3.5" />
              <span>{labels.eyebrow}</span>
            </div>
            <h2 className="mt-1 text-sm font-semibold">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMode("thumbnail")}
              aria-label={labels.minimize}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
            {entry.dismissible !== false ? (
              <button
                type="button"
                onClick={close}
                aria-label={labels.close}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        {videoFailed ? (
          <div className="flex aspect-video max-h-[75vh] items-center justify-center bg-neutral-100 px-6 text-center text-sm text-neutral-600">
            {labels.unavailable}
          </div>
        ) : (
          <video
            key={`${entry.slug}.az`}
            className="aspect-video max-h-[75vh] w-full bg-neutral-950"
            controls
            autoPlay
            playsInline
            preload="metadata"
            poster={posterFailed ? undefined : assets.posterSrc}
            src={assets.videoSrc}
            onError={() => setVideoFailed(true)}
          />
        )}
      </div>
    </div>
  )
}
