export const PHOTO_OUTBOX_MAX_FILES = 100
export const PHOTO_OUTBOX_MAX_BYTES = 512 * 1024 * 1024

export type PhotoStorageUsage = {
  files: number
  bytes: number
}

export type PhotoStorageDecision =
  | { allowed: true }
  | { allowed: false; reason: "file_count" | "byte_size" }

export function canStorePhoto(
  usage: PhotoStorageUsage,
  incomingBytes: number,
  limits = { maxFiles: PHOTO_OUTBOX_MAX_FILES, maxBytes: PHOTO_OUTBOX_MAX_BYTES },
): PhotoStorageDecision {
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    return { allowed: false, reason: "byte_size" }
  }
  if (usage.files + 1 > limits.maxFiles) return { allowed: false, reason: "file_count" }
  if (usage.bytes + incomingBytes > limits.maxBytes) return { allowed: false, reason: "byte_size" }
  return { allowed: true }
}

export class PhotoStorageLimitError extends Error {
  constructor(public readonly reason: "file_count" | "byte_size") {
    super(`photo_storage_limit:${reason}`)
    this.name = "PhotoStorageLimitError"
  }
}
