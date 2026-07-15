import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { handleMobilePull } from "@/server/mobile/sync-handlers"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const body = await req.json().catch(() => null)
  if (body == null) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  return handleMobilePull(body, session as { org: string; sub: string; did: string; role: string })
}
