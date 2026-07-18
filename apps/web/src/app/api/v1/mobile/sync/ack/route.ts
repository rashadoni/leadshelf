import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { handleMobileAck } from "@/server/mobile/sync-handlers"

import { consumeRateLimit } from "@/server/security/rate-limit"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const limit = await consumeRateLimit("mobile-sync", session.did, { max: 240, windowMs: 60_000 })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => null)
  if (body == null) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  return handleMobileAck(body, session as { org: string; sub: string; did: string; role: string })
}
