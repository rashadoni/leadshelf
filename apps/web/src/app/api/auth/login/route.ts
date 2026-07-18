import { NextRequest, NextResponse } from "next/server"
import { loginSchema } from "@/server/schemas/auth"
import { login } from "@/server/services/auth-service"
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from "@/server/auth/cookies"

import {
  clientAddress,
  consumeRateLimit,
  opaqueRateLimitKey,
} from "@/server/security/rate-limit"

import { writeSecurityAudit } from "@/server/security/audit"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const key = opaqueRateLimitKey([parsed.data.email.toLowerCase(), clientAddress(req)])
  const limit = await consumeRateLimit("web-login", key, { max: 10, windowMs: 15 * 60_000 })
  if (!limit.allowed) {
    writeSecurityAudit("authentication_rate_limited", { channel: "web", principalKey: key })
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  const result = await login(
    parsed.data.email,
    parsed.data.password,
    req.headers.get("user-agent") ?? undefined,
  )
  if (!result) {
    writeSecurityAudit("authentication_failed", { channel: "web", principalKey: key })
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }

  const res = NextResponse.json({ user: result.user })
  res.cookies.set(ACCESS_COOKIE, result.tokens.access, cookieOptions(ACCESS_MAX_AGE))
  res.cookies.set(REFRESH_COOKIE, result.tokens.refresh, cookieOptions(REFRESH_MAX_AGE))
  return res
}
