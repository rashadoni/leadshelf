import type { NextRequest } from "next/server"
import {
  consumeDurableRateLimit,
  opaqueRateLimitKey,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimitRow,
} from "@leadshelf/db"
import { workerDb } from "@/server/db/client"

export {
  consumeDurableRateLimit,
  opaqueRateLimitKey,
  type RateLimitResult,
  type RateLimitRule,
}

type Window = { count: number; resetAt: number }

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>()

  consume(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
    const current = this.windows.get(key)
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs })
      this.prune(now)
      return { allowed: true, retryAfterSeconds: 0 }
    }
    if (current.count >= rule.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      }
    }
    current.count++
    return { allowed: true, retryAfterSeconds: 0 }
  }

  private prune(now: number) {
    if (this.windows.size < 10_000) return
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key)
    }
  }
}

export function clientAddress(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")?.trim()
    ?? "unknown"
}

export function consumeRateLimit(
  scope: string,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  return consumeDurableRateLimit(
    (strings, ...values) =>
      workerDb.$queryRaw<RateLimitRow[]>(strings, ...values),
    scope,
    key,
    rule,
  )
}
