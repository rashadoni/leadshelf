export interface ImageDimensions {
  width: number
  height: number
}

export interface PhotoQualityInput {
  bytes: Uint8Array
  mimeType: string
  takenAt: Date
  receivedAt?: Date
  exif?: unknown
}

export interface PhotoQualityResult {
  score: number
  status: "GOOD" | "REVIEW" | "POOR"
  dimensions: ImageDimensions | null
  issues: string[]
}

const ONE_HOUR_MS = 60 * 60 * 1000
const NINETY_DAYS_MS = 90 * 24 * ONE_HOUR_MS

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) + bytes[offset + 1]!
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16)
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
  )
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + (bytes[offset + 1]! << 8)
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null
  if (
    bytes[0] !== 0x89 ||
    !matchesAscii(bytes, 1, "PNG") ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null
  }
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) return null
    const length = readU16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && length >= 7) {
      return { width: readU16BE(bytes, offset + 5), height: readU16BE(bytes, offset + 3) }
    }
    offset += length
  }
  return null
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
    return null
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
  if (chunk === "VP8X" && bytes.length >= 30) {
    return { width: readU24LE(bytes, 24) + 1, height: readU24LE(bytes, 27) + 1 }
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return { width: readU16LE(bytes, 26) & 0x3fff, height: readU16LE(bytes, 28) & 0x3fff }
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21]!
    const b2 = bytes[22]!
    const b3 = bytes[23]!
    const b4 = bytes[24]!
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + ((b4 & 0x0f) << 10) + (b3 << 2) + ((b2 & 0xc0) >> 6),
    }
  }
  return null
}

export function readImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  if (mimeType === "image/png") return parsePngDimensions(bytes)
  if (mimeType === "image/jpeg") return parseJpegDimensions(bytes)
  if (mimeType === "image/webp") return parseWebpDimensions(bytes)
  return null
}

export function evaluatePhotoQuality(input: PhotoQualityInput): PhotoQualityResult {
  const receivedAt = input.receivedAt ?? new Date()
  const issues: string[] = []
  let score = 1

  const dimensions = readImageDimensions(input.bytes, input.mimeType)
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    issues.push("image_dimensions_unreadable")
    score -= 0.35
  } else {
    const megapixels = (dimensions.width * dimensions.height) / 1_000_000
    const minSide = Math.min(dimensions.width, dimensions.height)
    if (minSide < 720 || megapixels < 1) {
      issues.push("low_resolution")
      score -= 0.25
    }
    if (dimensions.width > 12000 || dimensions.height > 12000) {
      issues.push("suspicious_dimensions")
      score -= 0.2
    }
  }

  if (input.bytes.byteLength < 100 * 1024) {
    issues.push("file_too_small")
    score -= 0.2
  }

  const drift = input.takenAt.getTime() - receivedAt.getTime()
  if (drift > ONE_HOUR_MS) {
    issues.push("taken_at_in_future")
    score -= 0.2
  }
  if (receivedAt.getTime() - input.takenAt.getTime() > NINETY_DAYS_MS) {
    issues.push("taken_at_too_old")
    score -= 0.15
  }

  if (!input.exif || typeof input.exif !== "object") {
    issues.push("missing_exif")
    score -= 0.1
  }

  const normalized = Math.max(0, Math.min(1, Number(score.toFixed(2))))
  return {
    score: normalized,
    status: normalized >= 0.8 ? "GOOD" : normalized >= 0.5 ? "REVIEW" : "POOR",
    dimensions,
    issues,
  }
}
