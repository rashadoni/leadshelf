import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { mobileLogout } from "@/server/services/mobile-auth-service"

export const runtime = "nodejs"

const schema = z.object({ refreshToken: z.string().optional() })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  await mobileLogout(parsed.success ? parsed.data.refreshToken : undefined)
  return NextResponse.json({ ok: true })
}
