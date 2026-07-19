import { NextResponse, type NextRequest } from "next/server"
import { mobileLoginRequestSchema } from "@leadshelf/api-contracts/mobile/v1"
import { mobileLogin } from "@/server/services/mobile-auth-service"
import { protocolMismatch } from "@/server/mobile/protocol"

import {
  clientAddress,
  consumeRateLimit,
  opaqueRateLimitKey,
} from "@/server/security/rate-limit"

import { writeSecurityAudit } from "@/server/security/audit"
import {
  accountLockoutState,
  clearAccountAuthenticationFailures,
  configuredAuthLockoutPolicy,
  mobileAccountLockoutKey,
  recordAccountAuthenticationFailure,
} from "@/server/security/auth-lockout"
export const runtime = "nodejs"
const INVALID_CREDENTIALS_HEADERS = { "Retry-After": "1" }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = mobileLoginRequestSchema.safeParse(body)
  if (!parsed.success) {
    const mismatch = protocolMismatch((body as { protocolVersion?: unknown })?.protocolVersion)
    if (mismatch) return mismatch
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  const key = opaqueRateLimitKey([
    parsed.data.orgSlug.toLowerCase(),
    parsed.data.employeeCode.toLowerCase(),
    clientAddress(req),
  ])
  const lockoutPolicy = configuredAuthLockoutPolicy()
  const accountKey = lockoutPolicy
    ? mobileAccountLockoutKey(
        parsed.data.orgSlug,
        parsed.data.employeeCode,
        lockoutPolicy.pepper,
      )
    : null
  const limit = await consumeRateLimit("mobile-login", key, {
    max: 10,
    windowMs: 15 * 60_000,
  })
  if (!limit.allowed) {
    writeSecurityAudit("authentication_rate_limited", { channel: "mobile", principalKey: key })
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  if (lockoutPolicy && accountKey) {
    const lockout = await accountLockoutState("mobile", accountKey)
    if (lockout.locked) {
      writeSecurityAudit("authentication_locked", { channel: "mobile", principalKey: accountKey })
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401, headers: INVALID_CREDENTIALS_HEADERS },
      )
    }
  }

  const result = await mobileLogin(parsed.data)
  if (!result) {
    writeSecurityAudit("authentication_failed", { channel: "mobile", principalKey: key })
    if (lockoutPolicy && accountKey) {
      const lockout = await recordAccountAuthenticationFailure("mobile", accountKey, lockoutPolicy)
      if (lockout.locked) {
        writeSecurityAudit("authentication_locked", { channel: "mobile", principalKey: accountKey })
      }
    }
    return NextResponse.json(
      { error: "invalid_credentials" },
      { status: 401, headers: INVALID_CREDENTIALS_HEADERS },
    )
  }
  if (lockoutPolicy && accountKey) {
    await clearAccountAuthenticationFailures("mobile", accountKey)
  }
  return NextResponse.json(result)
}
