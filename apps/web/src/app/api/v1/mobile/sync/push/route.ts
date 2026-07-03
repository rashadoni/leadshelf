import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { pushOperations, type PushOperation } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const schema = z.object({
  protocolVersion: z.number().int(),
  operations: z
    .array(
      z.object({
        clientOpId: z.string().min(8).max(128),
        kind: z.enum(["task.status", "photo.submit"]),
        payload: z.record(z.string(), z.unknown()),
        clientCreatedAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
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
