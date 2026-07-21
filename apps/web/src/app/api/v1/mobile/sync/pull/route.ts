import { NextResponse, type NextRequest } from "next/server"
import {
  mobileCaptureTemplateSchema,
  mobileSyncPullRequestSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import { pullChanges, storedCursors } from "@leadshelf/db"
import { SingleFlight } from "@/server/concurrency/single-flight"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { hasCompleteMobileCursorSet } from "@/server/mobile/cursors"
import { protocolMismatch } from "@/server/mobile/protocol"
import { workerDb } from "@/server/db/client"

import { consumeRateLimit } from "@/server/security/rate-limit"
export const runtime = "nodejs"

const mobilePullSingleFlight = new SingleFlight<
  string,
  Awaited<ReturnType<typeof pullChanges>>
>(1_000)

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const limit = await consumeRateLimit("mobile-sync", session.did, { max: 240, windowMs: 60_000 })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = mobileSyncPullRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  // Если клиент прислал полный набор (включая явные null), сохраненные
  // курсоры не нужны. Это убирает DB round-trip из каждого штатного delta
  // pull, сохраняя resume-семантику для частичного/пустого набора.
  const saved = hasCompleteMobileCursorSet(parsed.data.cursors)
    ? {}
    : await storedCursors(workerDb, session.did)
  const cursors = {
    tasks: parsed.data.cursors.tasks ?? saved.tasks ?? null,
    planogramBundles: parsed.data.cursors.planogramBundles ?? saved.planogramBundles ?? null,
    routes: parsed.data.cursors.routes ?? saved.routes ?? null,
    visits: parsed.data.cursors.visits ?? saved.visits ?? null,
    photoSubmissions: parsed.data.cursors.photoSubmissions ?? saved.photoSubmissions ?? null,
  }

  // Один пользователь может одновременно восстановить несколько устройств
  // или повторить initial request после сетевого timeout. Идентичные активные
  // pull объединяются только на время запроса; результата/tenant data cache нет.
  const pullKey = JSON.stringify([session.org, session.sub, cursors])
  const changes = await mobilePullSingleFlight.run(pullKey, () =>
    pullChanges(workerDb, session.org, session.sub, cursors),
  )
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
