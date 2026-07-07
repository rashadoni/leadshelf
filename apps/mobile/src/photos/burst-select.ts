// Выбор лучшего кадра из burst-серии без нативных модулей (docs/24 уровень 1).
// Резкость: JPEG одного разрешения/качества с бОльшим числом высокочастотных
// деталей сжимается хуже -> больший файл ~ более резкий кадр. Яркость: EXIF
// (BrightnessValue/ISO/ExposureTime), когда камера его отдает. Это честные
// эвристики: они сокращают долю плохих кадров, но не заменяют серверный
// quality gate и никогда не блокируют отправку.

export interface BurstShot {
  uri: string
  byteSize: number | null
  exif?: Record<string, unknown> | null
}

export type BurstIssue = "too_dark" | "low_light"

export interface BurstSelection {
  bestIndex: number
  issues: BurstIssue[]
}

// BrightnessValue (APEX Bv): ~<= -1 — темная сцена, дальше только шум.
const TOO_DARK_BRIGHTNESS = -1
// Высокий ISO + длинная выдержка: камера борется с темнотой, кадр шумный/смазанный.
const LOW_LIGHT_ISO = 1600
const LOW_LIGHT_EXPOSURE_S = 1 / 20

function numberField(exif: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = exif?.[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value) && typeof value[0] === "number") return value[0]
  return null
}

export function evaluateShotExif(exif: Record<string, unknown> | null | undefined): BurstIssue[] {
  if (!exif) return []
  const issues: BurstIssue[] = []
  const brightness = numberField(exif, "BrightnessValue")
  if (brightness != null && brightness <= TOO_DARK_BRIGHTNESS) issues.push("too_dark")
  const iso = numberField(exif, "ISOSpeedRatings") ?? numberField(exif, "PhotographicSensitivity")
  const exposure = numberField(exif, "ExposureTime")
  if (
    !issues.includes("too_dark") &&
    iso != null &&
    exposure != null &&
    iso >= LOW_LIGHT_ISO &&
    exposure >= LOW_LIGHT_EXPOSURE_S
  ) {
    issues.push("low_light")
  }
  return issues
}

/**
 * Лучший кадр серии: максимальный размер файла при одинаковых параметрах
 * съемки; при равенстве — первый (снят раньше, меньше увода камеры).
 */
export function selectBestBurstShot(shots: BurstShot[]): BurstSelection {
  if (shots.length === 0) return { bestIndex: -1, issues: [] }
  let bestIndex = 0
  let bestSize = shots[0]!.byteSize ?? -1
  for (let i = 1; i < shots.length; i += 1) {
    const size = shots[i]!.byteSize ?? -1
    if (size > bestSize) {
      bestIndex = i
      bestSize = size
    }
  }
  return { bestIndex, issues: evaluateShotExif(shots[bestIndex]!.exif) }
}
