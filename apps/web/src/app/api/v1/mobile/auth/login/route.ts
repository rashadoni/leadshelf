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
export const runtime = "nodejs"

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

  const result = await mobileLogin(parsed.data)
  if (!result) {
    writeSecurityAudit("authentication_failed", { channel: "mobile", principalKey: key })
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }
  return NextResponse.json(result)
}
