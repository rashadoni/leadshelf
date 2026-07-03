import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { mobileLogin } from "@/server/services/mobile-auth-service"
import { protocolMismatch } from "@/server/mobile/protocol"

export const runtime = "nodejs"

const schema = z.object({
  protocolVersion: z.number().int(),
  orgSlug: z.string().trim().min(1),
  employeeCode: z.string().trim().min(1).max(64),
  pin: z.string().min(1).max(64),
  device: z.object({
    id: z.string().min(8).max(128),
    platform: z.string().min(1).max(32),
    deviceName: z.string().max(128).optional(),
    pushToken: z.string().max(512).optional(),
  }),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
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
