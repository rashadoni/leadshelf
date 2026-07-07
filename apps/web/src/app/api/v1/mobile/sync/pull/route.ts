import { NextResponse, type NextRequest } from "next/server"
import {
  mobileCaptureTemplateSchema,
  mobileSyncPullRequestSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import { pullChanges, storedCursors } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const body = await req.json().catch(() => null)
  const parsed = mobileSyncPullRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  // если клиент не прислал курсоры (свежая установка) — берем сохраненные
  const saved = await storedCursors(workerDb, session.did)
  const cursors = {
    tasks: parsed.data.cursors.tasks ?? saved.tasks ?? null,
    planogramBundles: parsed.data.cursors.planogramBundles ?? saved.planogramBundles ?? null,
    routes: parsed.data.cursors.routes ?? saved.routes ?? null,
    visits: parsed.data.cursors.visits ?? saved.visits ?? null,
    photoSubmissions: parsed.data.cursors.photoSubmissions ?? saved.photoSubmissions ?? null,
  }

  const changes = await pullChanges(workerDb, session.org, session.sub, cursors)
  // Guided Capture: steps лежат в БД как raw JSON — валидируем контрактом на
  // границе; кривой шаблон превращается в null (fallback на встроенный
  // сценарий в приложении), а не ломает весь pull.
  const tasks = changes.tasks.map((task) => {
    if (!task.captureTemplate) return task
    const parsed = mobileCaptureTemplateSchema.safeParse(task.captureTemplate)
    return { ...task, captureTemplate: parsed.success ? parsed.data : null }
  })
  return NextResponse.json({ ...changes, tasks })
}
