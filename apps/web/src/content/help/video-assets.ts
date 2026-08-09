import { HELP_VIDEO_AVAILABILITY } from "./video-availability.generated"

export type HelpVideoLocale = "az"

export interface HelpVideoEntry {
  slug: string
  routes: readonly string[]
  title: string
}

const HELP_VIDEO_BASE_PATH = process.env.NEXT_PUBLIC_HELP_VIDEO_BASE_URL ?? "/api/help-videos"

// Bump this value whenever an existing media filename is replaced. The query
// string prevents browsers/CDNs from continuing to serve the previous bytes.
export const HELP_VIDEO_ASSET_VERSION = "20260809-az-section-guides-v1"

export const HELP_VIDEO_ENTRIES = [
  { slug: "overview", routes: ["/"], title: "LeadShelf paneli" },
  { slug: "catalog", routes: ["/catalog"], title: "Məhsul kataloqu" },
  { slug: "catalog-import", routes: ["/catalog/import"], title: "Kataloq idxalı" },
  { slug: "catalog-quality", routes: ["/catalog/quality"], title: "Data keyfiyyəti" },
  { slug: "equipment-library", routes: ["/equipment-library"], title: "Avadanlıq kitabxanası" },
  { slug: "equipment-new", routes: ["/equipment-library/new"], title: "Yeni avadanlıq" },
  { slug: "equipment-editor", routes: ["/equipment-library/*"], title: "Avadanlıq redaktoru" },
  { slug: "stores", routes: ["/stores"], title: "Satış nöqtələri" },
  { slug: "store-detail", routes: ["/stores/*"], title: "Satış nöqtəsinin kartı" },
  { slug: "floor-plans", routes: ["/floor-plans"], title: "Zal planları" },
  { slug: "planograms", routes: ["/planograms"], title: "Planoqramlar" },
  { slug: "planogram-new", routes: ["/planograms/new"], title: "Yeni planoqram" },
  { slug: "planogram-editor", routes: ["/planograms/*"], title: "Planoqram redaktoru" },
  { slug: "tasks", routes: ["/tasks"], title: "Tapşırıqlar" },
  { slug: "task-detail", routes: ["/tasks/*"], title: "Tapşırığın icrası" },
  { slug: "reviews", routes: ["/reviews"], title: "Foto yoxlama" },
  { slug: "field-force", routes: ["/field-force"], title: "Sahə komandası" },
  { slug: "orders", routes: ["/orders"], title: "Sifarişlər" },
  { slug: "analytics", routes: ["/analytics"], title: "Analitika" },
] as const satisfies readonly HelpVideoEntry[]

const AVAILABLE = new Set<string>(HELP_VIDEO_AVAILABILITY)

const ROUTED_ENTRIES = [...HELP_VIDEO_ENTRIES].sort((a, b) => {
  const longestA = Math.max(...a.routes.map((route) => route.length))
  const longestB = Math.max(...b.routes.map((route) => route.length))
  return longestB - longestA
})

function normalizePath(pathname: string) {
  const withoutQuery = pathname.split("?")[0] || "/"
  const withoutLocale = withoutQuery.replace(/^\/(?:az|ru)(?=\/|$)/, "") || "/"
  return withoutLocale.length > 1 ? withoutLocale.replace(/\/$/, "") : withoutLocale
}

function routeMatches(pathname: string, route: string) {
  if (route.endsWith("/*")) {
    return pathname.startsWith(`${route.slice(0, -2)}/`)
  }
  return pathname === route
}

export function normalizeHelpVideoLocale(locale: string): HelpVideoLocale | null {
  return locale === "az" ? "az" : null
}

export function isHelpVideoAvailable(slug: string, locale: HelpVideoLocale = "az") {
  return AVAILABLE.has(`${slug}.${locale}`)
}

export function getHelpVideoForPath(pathname: string | null, locale: HelpVideoLocale = "az") {
  if (!pathname) return null
  const entry = getRegisteredHelpVideoForPath(pathname)
  return entry && isHelpVideoAvailable(entry.slug, locale) ? entry : null
}

export function getRegisteredHelpVideoForPath(pathname: string | null) {
  if (!pathname) return null
  const cleanPath = normalizePath(pathname)
  return ROUTED_ENTRIES.find((candidate) =>
    candidate.routes.some((route) => routeMatches(cleanPath, route)),
  ) ?? null
}

export function getHelpVideoForSlug(slug: string, locale: HelpVideoLocale = "az") {
  const entry = HELP_VIDEO_ENTRIES.find((candidate) => candidate.slug === slug)
  return entry && isHelpVideoAvailable(entry.slug, locale) ? entry : null
}

export function getHelpVideoAsset(entry: HelpVideoEntry, locale: HelpVideoLocale = "az") {
  if (!isHelpVideoAvailable(entry.slug, locale)) return null
  const name = encodeURIComponent(`${entry.slug}.${locale}`)
  const version = `?v=${HELP_VIDEO_ASSET_VERSION}`
  return {
    videoSrc: `${HELP_VIDEO_BASE_PATH}/${name}.VOICE.mp4${version}`,
    posterSrc: `${HELP_VIDEO_BASE_PATH}/${name}.poster.jpg${version}`,
  }
}
