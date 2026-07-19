export const MEDIA_ENCRYPTION_KEY_NAME = "ls.media.key.v1"
export const MEDIA_ENCRYPTION_MARKER_NAME = ".leadshelf-media-encryption-v1"
export const MEDIA_ENCRYPTION_VERSION = 1
export const MEDIA_TEMP_SUFFIX = ".lsmedia.tmp"

export const MEDIA_MAGIC = new Uint8Array([0x4c, 0x53, 0x4d, 0x45, 0x44, 0x30, 0x31, 0x00])

export type MediaEncryptionBootstrapPlan =
  | "create"
  | "resume-migration"
  | "open"
  | "missing-key"

export function mediaEncryptionBootstrapPlan(input: {
  keyExists: boolean
  marker: string | null
}): MediaEncryptionBootstrapPlan {
  if (input.marker && !input.keyExists) return "missing-key"
  if (!input.keyExists) return "create"
  return input.marker === "ready:v1" ? "open" : "resume-migration"
}

export function hasEncryptedMediaHeader(bytes: Uint8Array): boolean {
  return bytes.length >= MEDIA_MAGIC.length
    && MEDIA_MAGIC.every((value, index) => bytes[index] === value)
}

export function sealEncryptedMediaPayload(combined: Uint8Array): Uint8Array {
  const output = new Uint8Array(MEDIA_MAGIC.length + combined.length)
  output.set(MEDIA_MAGIC)
  output.set(combined, MEDIA_MAGIC.length)
  return output
}

export function openEncryptedMediaPayload(bytes: Uint8Array): Uint8Array {
  if (!hasEncryptedMediaHeader(bytes)) throw new Error("[mobile-media] encrypted file marker is missing")
  const combined = bytes.slice(MEDIA_MAGIC.length)
  if (combined.length < 28) throw new Error("[mobile-media] encrypted file is truncated")
  return combined
}

export function normalizeMediaKey(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f\d]{64}$/.test(normalized)) {
    throw new Error("[mobile-media] invalid AES-256 key material")
  }
  return normalized
}

export function safeTemporaryExtension(uri: string): string {
  const name = uri.split("/").at(-1) ?? "media.bin"
  const extension = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() : "bin"
  return extension && /^[a-z\d]{1,10}$/.test(extension) ? extension : "bin"
}
