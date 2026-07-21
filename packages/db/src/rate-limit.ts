import { createHash } from "node:crypto"

export type RateLimitRule = { max: number; windowMs: number }
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }
export type RateLimitRow = { count: number; expiresAt: Date }
export type RateLimitQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<RateLimitRow[]>

export function opaqueRateLimitKey(parts: Array<string | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\u0000"))
    .digest("hex")
}

export async function consumeDurableRateLimit(
  query: RateLimitQuery,
  scope: string,
  key: string,
  rule: RateLimitRule,
  now = new Date(),
): Promise<RateLimitResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(scope)) throw new Error("invalid rate limit scope")
  if (!key || !Number.isInteger(rule.max) || rule.max < 1 || !Number.isFinite(rule.windowMs) || rule.windowMs < 50) {
    throw new Error("invalid rate limit rule")
  }

  const keyHash = opaqueRateLimitKey([key])
  const freshExpiry = new Date(now.getTime() + Math.floor(rule.windowMs))
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60_000)
  const rows = await query`
    WITH expired AS (
      DELETE FROM "rate_limit_buckets" WHERE "expiresAt" < ${retentionCutoff}
      RETURNING 1
    )
    INSERT INTO "rate_limit_buckets"
      ("scope", "keyHash", "count", "windowStartedAt", "expiresAt", "updatedAt")
    VALUES
      (${scope}, ${keyHash}, 1, ${now}, ${freshExpiry}, ${now})
    ON CONFLICT ("scope", "keyHash") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."expiresAt" <= ${now} THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "rate_limit_buckets"."expiresAt" <= ${now} THEN ${now}
        ELSE "rate_limit_buckets"."windowStartedAt"
      END,
      "expiresAt" = CASE
        WHEN "rate_limit_buckets"."expiresAt" <= ${now} THEN ${freshExpiry}
        ELSE "rate_limit_buckets"."expiresAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "expiresAt"
  `
  const row = rows[0]
  if (!row) throw new Error("rate limit persistence failed")
  if (row.count <= rule.max) return { allowed: true, retryAfterSeconds: 0 }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)),
  }
}
