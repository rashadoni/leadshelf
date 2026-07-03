import { NextResponse, type NextRequest } from "next/server"
import { mobileLoginRequestSchema } from "@leadshelf/api-contracts/mobile/v1"
import { mobileLogin } from "@/server/services/mobile-auth-service"
import { protocolMismatch } from "@/server/mobile/protocol"

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

  const result = await mobileLogin(parsed.data)
  if (!result) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  return NextResponse.json(result)
}
