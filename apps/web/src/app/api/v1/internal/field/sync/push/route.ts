import { NextResponse, type NextRequest } from "next/server"
import { requireFieldBffSession } from "@/server/field-bff/auth"
import { handleMobilePush } from "@/server/mobile/sync-handlers"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const auth = await requireFieldBffSession(req)
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => null)
  if (body == null) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  return handleMobilePush(body, auth.session)
}
