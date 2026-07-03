import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ackCursors } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const schema = z.object({
  protocolVersion: z.number().int(),
  appliedCursors: z.record(z.string(), z.string()),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  await ackCursors(workerDb, session.did, parsed.data.appliedCursors)
  return NextResponse.json({ ok: true })
}
