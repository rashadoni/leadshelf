import { NextResponse, type NextRequest } from "next/server"
import { mobileSyncPushRequestSchema } from "@leadshelf/api-contracts/mobile/v1"
import { pushOperations, type PushOperation } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

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
  const parsed = mobileSyncPushRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  const results = await pushOperations(
    workerDb,
    session.org,
    session.sub,
    session.did,
    parsed.data.operations as PushOperation[],
  )
  return NextResponse.json({ results })
}
