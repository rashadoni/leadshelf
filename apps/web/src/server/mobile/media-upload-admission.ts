import { NextResponse } from "next/server"
import type { RateLimitRule } from "@/server/security/rate-limit"
import { consumeRateLimit } from "@/server/security/rate-limit"
import { TrySemaphore } from "@/server/concurrency/try-semaphore"

const configuredUploadConcurrency = Number(process.env.LEADSHELF_MEDIA_UPLOAD_CONCURRENCY ?? 8)
const mediaUploadSemaphore = new TrySemaphore(
  Number.isInteger(configuredUploadConcurrency) &&
    configuredUploadConcurrency >= 1 &&
    configuredUploadConcurrency <= 32
    ? configuredUploadConcurrency
    : 8,
)

type MediaUploadAdmission =
  | { ok: true; release: () => void }
  | { ok: false; response: NextResponse }

export async function acquireMediaUploadAdmission(
  scope: string,
  key: string,
  rule: RateLimitRule,
): Promise<MediaUploadAdmission> {
  const limit = await consumeRateLimit(scope, key, rule)
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      ),
    }
  }

  const release = mediaUploadSemaphore.tryAcquire()
  if (!release) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "upload_capacity_exhausted" },
        { status: 503, headers: { "Retry-After": "2" } },
      ),
    }
  }
  return { ok: true, release }
}
