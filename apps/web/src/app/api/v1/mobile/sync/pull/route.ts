import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { pullChanges, storedCursors } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const schema = z.object({
  protocolVersion: z.number().int(),
  cursors: z
    .object({
      tasks: z.string().nullable().optional(),
      planogramBundles: z.string().nullable().optional(),
    })
    .default({}),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  // если клиент не прислал курсоры (свежая установка) — берем сохраненные
  const saved = await storedCursors(workerDb, session.did)
  const cursors = {
    tasks: parsed.data.cursors.tasks ?? saved.tasks ?? null,
    planogramBundles: parsed.data.cursors.planogramBundles ?? saved.planogramBundles ?? null,
  }

  const changes = await pullChanges(workerDb, session.org, session.sub, cursors)
  return NextResponse.json(changes)
}
