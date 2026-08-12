import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

type WorkdayRow = Awaited<ReturnType<typeof loadWorkday>>

function dateKey(raw: string | null): string | null {
  const value = raw ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null
}

function actions(status: "STARTED" | "PAUSED" | "COMPLETED" | null) {
  if (status === "STARTED") return ["PAUSE", "FINISH"] as const
  if (status === "PAUSED") return ["RESUME", "FINISH"] as const
  if (status === "COMPLETED") return [] as const
  return ["START"] as const
}

async function loadWorkday(id: string) {
  return workerDb.agentWorkday.findUnique({
    where: { id },
    include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } },
  })
}

function shapeWorkday(row: NonNullable<WorkdayRow>) {
  const end = row.completedAt ?? new Date()
  const livePause = row.status === "PAUSED" && row.pausedAt
    ? Math.max(0, Math.floor((end.getTime() - row.pausedAt.getTime()) / 1000))
    : 0
  const paused = row.totalPausedSeconds + livePause
  const worked = Math.max(0, Math.floor((end.getTime() - row.startedAt.getTime()) / 1000) - paused)
  return {
    id: row.id,
    workDate: row.workDate.toISOString(),
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    pausedAt: row.pausedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    totalPausedSeconds: row.totalPausedSeconds,
    workedSeconds: worked,
    startLatitude: row.startLatitude,
    startLongitude: row.startLongitude,
    endLatitude: row.endLatitude,
    endLongitude: row.endLongitude,
    availableActions: [...actions(row.status)],
    events: row.events.map((event) => ({
      id: event.id,
      clientEventId: event.clientEventId,
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
      latitude: event.latitude,
      longitude: event.longitude,
      accuracy: event.accuracy,
      note: event.note,
    })),
  }
}

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const requestedDate = dateKey(new URL(req.url).searchParams.get("date"))
  if (!requestedDate) return NextResponse.json({ error: "invalid_date" }, { status: 400 })

  const agent = await workerDb.fieldAgent.findFirst({
    where: { organizationId: session.org, userId: session.sub },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: "field_agent_not_found" }, { status: 403 })

  const workDate = new Date(`${requestedDate}T00:00:00.000Z`)
  const [requested, active, settings] = await Promise.all([
    workerDb.agentWorkday.findUnique({
      where: {
        organizationId_agentId_workDate: {
          organizationId: session.org,
          agentId: agent.id,
          workDate,
        },
      },
      include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } },
    }),
    workerDb.agentWorkday.findFirst({
      where: { organizationId: session.org, agentId: agent.id, status: { in: ["STARTED", "PAUSED"] } },
      include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } },
      orderBy: { startedAt: "desc" },
    }),
    workerDb.fieldForceSetting.findUnique({
      where: { organizationId: session.org },
      select: { gpsRefreshSeconds: true },
    }),
  ])

  const shapedRequested = requested ? shapeWorkday(requested) : null
  const shapedActive = active
    ? (requested?.id === active.id ? shapedRequested : shapeWorkday(active))
    : null
  const availableActions = shapedActive
    ? shapedActive.availableActions
    : shapedRequested
      ? shapedRequested.availableActions
      : ["START"]

  return NextResponse.json({
    success: true,
    data: {
      date: requestedDate,
      today: new Date().toISOString().slice(0, 10),
      timezone: "UTC",
      gpsIntervalSeconds: settings?.gpsRefreshSeconds ?? 15,
      workday: shapedRequested,
      activeWorkday: shapedActive,
      availableActions,
    },
  })
}
