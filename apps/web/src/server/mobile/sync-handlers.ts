import { NextResponse } from "next/server"
import {
  mobileCaptureTemplateSchema,
  mobileSyncAckRequestSchema,
  mobileSyncPullRequestSchema,
  mobileSyncPushRequestSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import {
  ackCursors,
  pullChanges,
  pushOperations,
  storedCursors,
  type PushOperation,
} from "@leadshelf/db"
import { workerDb } from "@/server/db/client"
import { protocolMismatch } from "@/server/mobile/protocol"

export type MobileExecutionSession = {
  org: string
  sub: string
  did: string
  role: string
}

export async function handleMobilePull(body: unknown, session: MobileExecutionSession) {
  const parsed = mobileSyncPullRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  const saved = await storedCursors(workerDb, session.did)
  const cursors = {
    tasks: parsed.data.cursors.tasks ?? saved.tasks ?? null,
    planogramBundles: parsed.data.cursors.planogramBundles ?? saved.planogramBundles ?? null,
    routes: parsed.data.cursors.routes ?? saved.routes ?? null,
    visits: parsed.data.cursors.visits ?? saved.visits ?? null,
    photoSubmissions: parsed.data.cursors.photoSubmissions ?? saved.photoSubmissions ?? null,
  }

  const changes = await pullChanges(workerDb, session.org, session.sub, cursors)
  const tasks = changes.tasks.map((task) => {
    if (!task.captureTemplate) return task
    const captureTemplate = mobileCaptureTemplateSchema.safeParse(task.captureTemplate)
    return { ...task, captureTemplate: captureTemplate.success ? captureTemplate.data : null }
  })
  return NextResponse.json({ ...changes, tasks })
}

export async function handleMobilePush(body: unknown, session: MobileExecutionSession) {
  const parsed = mobileSyncPushRequestSchema.safeParse(body)
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

export async function handleMobileAck(body: unknown, session: MobileExecutionSession) {
  const parsed = mobileSyncAckRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const mismatch = protocolMismatch(parsed.data.protocolVersion)
  if (mismatch) return mismatch

  await ackCursors(workerDb, session.did, parsed.data.appliedCursors)
  return NextResponse.json({ ok: true })
}
