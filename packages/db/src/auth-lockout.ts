import { opaqueRateLimitKey } from "./rate-limit.ts"

export type AuthenticationLockoutPolicy = {
  maxFailures: number
  windowMs: number
  lockoutMs: number
}

export type AuthenticationLockoutState = {
  locked: boolean
  failureCount: number
  retryAfterSeconds: number
  lockedUntil: Date | null
}

type LockoutRow = {
  failureCount: number
  lockedUntil: Date | null
}

export type AuthenticationLockoutQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<LockoutRow[]>

export type AuthenticationLockoutExecute = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<number>

function assertScope(scope: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(scope)) throw new Error("invalid authentication lockout scope")
}

export function validateAuthenticationLockoutPolicy(
  policy: AuthenticationLockoutPolicy,
): AuthenticationLockoutPolicy {
  if (!Number.isInteger(policy.maxFailures) || policy.maxFailures < 2 || policy.maxFailures > 100) {
    throw new Error("authentication lockout maxFailures must be an integer between 2 and 100")
  }
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 60_000 || policy.windowMs > 24 * 60 * 60_000) {
    throw new Error("authentication lockout windowMs must be between 1 minute and 24 hours")
  }
  if (!Number.isInteger(policy.lockoutMs) || policy.lockoutMs < 60_000 || policy.lockoutMs > 7 * 24 * 60 * 60_000) {
    throw new Error("authentication lockout lockoutMs must be between 1 minute and 7 days")
  }
  return policy
}

function state(row: LockoutRow | undefined, now: Date): AuthenticationLockoutState {
  const lockedUntil = row?.lockedUntil ?? null
  const locked = Boolean(lockedUntil && lockedUntil.getTime() > now.getTime())
  return {
    locked,
    failureCount: row?.failureCount ?? 0,
    retryAfterSeconds: lockedUntil && locked
      ? Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1_000))
      : 0,
    lockedUntil,
  }
}

export async function getAuthenticationLockout(
  query: AuthenticationLockoutQuery,
  scope: string,
  key: string,
  now = new Date(),
): Promise<AuthenticationLockoutState> {
  assertScope(scope)
  if (!key) throw new Error("authentication lockout key is required")
  const keyHash = opaqueRateLimitKey([key])
  const rows = await query`
    SELECT "failureCount", "lockedUntil"
    FROM "authentication_lockouts"
    WHERE "scope" = ${scope} AND "keyHash" = ${keyHash}
    LIMIT 1
  `
  return state(rows[0], now)
}

export async function recordAuthenticationFailure(
  query: AuthenticationLockoutQuery,
  scope: string,
  key: string,
  policyInput: AuthenticationLockoutPolicy,
  now = new Date(),
): Promise<AuthenticationLockoutState> {
  assertScope(scope)
  if (!key) throw new Error("authentication lockout key is required")
  const policy = validateAuthenticationLockoutPolicy(policyInput)
  const keyHash = opaqueRateLimitKey([key])
  const windowExpiresAt = new Date(now.getTime() + policy.windowMs)
  const lockoutExpiresAt = new Date(now.getTime() + policy.lockoutMs)
  const retentionCutoff = new Date(now.getTime() - 8 * 24 * 60 * 60_000)
  const rows = await query`
    WITH expired AS (
      DELETE FROM "authentication_lockouts"
      WHERE "windowExpiresAt" < ${retentionCutoff}
        AND ("lockedUntil" IS NULL OR "lockedUntil" < ${retentionCutoff})
      RETURNING 1
    )
    INSERT INTO "authentication_lockouts"
      ("scope", "keyHash", "failureCount", "windowStartedAt", "windowExpiresAt", "lockedUntil", "updatedAt")
    VALUES
      (${scope}, ${keyHash}, 1, ${now}, ${windowExpiresAt}, NULL, ${now})
    ON CONFLICT ("scope", "keyHash") DO UPDATE SET
      "failureCount" = CASE
        WHEN "authentication_lockouts"."lockedUntil" > ${now}
          THEN "authentication_lockouts"."failureCount"
        WHEN "authentication_lockouts"."lockedUntil" IS NOT NULL THEN 1
        WHEN "authentication_lockouts"."windowExpiresAt" <= ${now} THEN 1
        ELSE "authentication_lockouts"."failureCount" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "authentication_lockouts"."lockedUntil" > ${now}
          THEN "authentication_lockouts"."windowStartedAt"
        WHEN "authentication_lockouts"."lockedUntil" IS NOT NULL THEN ${now}
        WHEN "authentication_lockouts"."windowExpiresAt" <= ${now} THEN ${now}
        ELSE "authentication_lockouts"."windowStartedAt"
      END,
      "windowExpiresAt" = CASE
        WHEN "authentication_lockouts"."lockedUntil" > ${now}
          THEN "authentication_lockouts"."windowExpiresAt"
        WHEN "authentication_lockouts"."lockedUntil" IS NOT NULL THEN ${windowExpiresAt}
        WHEN "authentication_lockouts"."windowExpiresAt" <= ${now} THEN ${windowExpiresAt}
        ELSE "authentication_lockouts"."windowExpiresAt"
      END,
      "lockedUntil" = CASE
        WHEN "authentication_lockouts"."lockedUntil" > ${now}
          THEN "authentication_lockouts"."lockedUntil"
        WHEN (
          CASE
            WHEN "authentication_lockouts"."lockedUntil" IS NOT NULL THEN 1
            WHEN "authentication_lockouts"."windowExpiresAt" <= ${now} THEN 1
            ELSE "authentication_lockouts"."failureCount" + 1
          END
        ) >= ${policy.maxFailures} THEN ${lockoutExpiresAt}
        ELSE NULL
      END,
      "updatedAt" = ${now}
    RETURNING "failureCount", "lockedUntil"
  `
  const row = rows[0]
  if (!row) throw new Error("authentication lockout persistence failed")
  return state(row, now)
}

export async function clearAuthenticationFailures(
  execute: AuthenticationLockoutExecute,
  scope: string,
  key: string,
): Promise<void> {
  assertScope(scope)
  if (!key) throw new Error("authentication lockout key is required")
  const keyHash = opaqueRateLimitKey([key])
  await execute`
    DELETE FROM "authentication_lockouts"
    WHERE "scope" = ${scope} AND "keyHash" = ${keyHash}
  `
}
