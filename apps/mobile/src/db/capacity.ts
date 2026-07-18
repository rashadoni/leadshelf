import {
  PHOTO_OUTBOX_MAX_BYTES,
  PHOTO_OUTBOX_MAX_FILES,
  type PhotoStorageUsage,
} from "../photos/photo-storage-policy"

export type LocalDatabaseCapacity = {
  allocatedBytes: number
  usedBytes: number
  freeBytes: number
}

export type LocalCapacityLevel = "ok" | "near_limit" | "full"

export function calculateLocalDatabaseCapacity(input: {
  pageCount: number
  pageSize: number
  freePageCount: number
}): LocalDatabaseCapacity {
  const pageCount = Math.max(0, Math.floor(input.pageCount))
  const pageSize = Math.max(0, Math.floor(input.pageSize))
  const freePageCount = Math.min(pageCount, Math.max(0, Math.floor(input.freePageCount)))
  return {
    allocatedBytes: pageCount * pageSize,
    usedBytes: (pageCount - freePageCount) * pageSize,
    freeBytes: freePageCount * pageSize,
  }
}

export function photoCapacityLevel(
  usage: PhotoStorageUsage,
  limits = { maxFiles: PHOTO_OUTBOX_MAX_FILES, maxBytes: PHOTO_OUTBOX_MAX_BYTES },
): LocalCapacityLevel {
  const fileRatio = limits.maxFiles > 0 ? usage.files / limits.maxFiles : 1
  const byteRatio = limits.maxBytes > 0 ? usage.bytes / limits.maxBytes : 1
  const ratio = Math.max(fileRatio, byteRatio)
  if (ratio >= 1) return "full"
  if (ratio >= 0.8) return "near_limit"
  return "ok"
}

export function formatCapacityBytes(bytes: number): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0)
  if (safe < 1024) return `${Math.round(safe)} B`
  if (safe < 1024 ** 2) return `${(safe / 1024).toFixed(1)} KiB`
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MiB`
  return `${(safe / 1024 ** 3).toFixed(1)} GiB`
}
