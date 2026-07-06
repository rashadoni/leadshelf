import { createHmac, timingSafeEqual } from "node:crypto"

export const VISION_MEDIA_DEFAULT_TTL_SECONDS = 15 * 60

export type BuildVisionMediaUrlInput = {
  key: string
  publicBaseUrl?: string
  secret?: string
  now?: Date
  ttlSeconds?: number
}

export type VerifyVisionMediaSignatureInput = {
  key: string
  expires: number
  signature: string
  secret: string
  now?: Date
}

function signVisionMediaKey(key: string, expires: number, secret: string): string {
  return createHmac("sha256", secret).update(`${key}.${expires}`).digest("base64url")
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/")
}

export function buildVisionMediaUrl({
  key,
  publicBaseUrl = process.env.VISION_MEDIA_PUBLIC_BASE_URL,
  secret = process.env.VISION_MEDIA_SIGNING_SECRET,
  now = new Date(),
  ttlSeconds = VISION_MEDIA_DEFAULT_TTL_SECONDS,
}: BuildVisionMediaUrlInput): string {
  if (!publicBaseUrl?.trim() || !secret?.trim()) return key
  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds
  const signature = signVisionMediaKey(key, expires, secret)
  const base = publicBaseUrl.replace(/\/+$/, "")
  return `${base}/api/vision-media/${encodeKeyPath(key)}?expires=${expires}&sig=${signature}`
}

export function verifyVisionMediaSignature({
  key,
  expires,
  signature,
  secret,
  now = new Date(),
}: VerifyVisionMediaSignatureInput): boolean {
  if (!secret.trim() || !signature.trim() || !Number.isFinite(expires)) return false
  if (expires < Math.floor(now.getTime() / 1000)) return false

  const expected = Buffer.from(signVisionMediaKey(key, expires, secret))
  const actual = Buffer.from(signature)
  if (expected.byteLength !== actual.byteLength) return false
  return timingSafeEqual(expected, actual)
}
