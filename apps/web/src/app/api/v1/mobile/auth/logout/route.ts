import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { mobileLogout } from "@/server/services/mobile-auth-service"
import { protocolMismatch } from "@/server/mobile/protocol"

export const runtime = "nodejs"

const schema = z.object({
  protocolVersion: z.number().int(),
  refreshToken: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch
  await mobileLogout(parsed.data.refreshToken)
  return NextResponse.json({ ok: true })
}
