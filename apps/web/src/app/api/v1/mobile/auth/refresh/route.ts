import { NextResponse, type NextRequest } from "next/server"
import { mobileRefreshRequestSchema } from "@leadshelf/api-contracts/mobile/v1"
import { mobileRefresh } from "@/server/services/mobile-auth-service"
import { protocolMismatch } from "@/server/mobile/protocol"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = mobileRefreshRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  const pair = await mobileRefresh(parsed.data.refreshToken, parsed.data.deviceId)
  if (!pair) return NextResponse.json({ error: "invalid_refresh" }, { status: 401 })
  return NextResponse.json(pair)
}
