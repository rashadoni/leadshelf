import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const locationSchema = z.object({
  clientLocationId: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(5000).nullable().optional(),
  speed: z.number().min(0).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  altitude: z.number().nullable().optional(),
  battery: z.number().min(0).max(100).nullable().optional(),
  recordedAt: z.string().datetime(),
})

function validDate(raw: string | null) {
  const value = raw ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const start = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== value) return null
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { value, start, end }
}

async function currentAgent(organizationId: string, userId: string) {
  return workerDb.fieldAgent.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  })
}

function shapeLocation(row: {
  id: string
  clientLocationId: string | null
  latitude: number
  longitude: number
  accuracyM: number | null
  recordedAt: Date
}) {
  return {
    id: row.id,
    clientLocationId: row.clientLocationId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracyM,
    speed: null,
    heading: null,
    altitude: null,
    battery: null,
    isMoving: false,
    recordedAt: row.recordedAt.toISOString(),
  }
}

function distanceMeters(points: Array<{ latitude: number; longitude: number }>) {
  const earthRadiusM = 6_371_000
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    const lat1 = previous.latitude * Math.PI / 180
    const lat2 = current.latitude * Math.PI / 180
    const deltaLat = (current.latitude - previous.latitude) * Math.PI / 180
    const deltaLng = (current.longitude - previous.longitude) * Math.PI / 180
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
    total += earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  return Math.round(total)
}

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const day = validDate(new URL(req.url).searchParams.get("date"))
  if (!day) return NextResponse.json({ error: "invalid_date" }, { status: 400 })
  const agent = await currentAgent(session.org, session.sub)
  if (!agent) return NextResponse.json({ error: "field_agent_not_found" }, { status: 403 })

  const [rows, settings] = await Promise.all([
    workerDb.agentLocation.findMany({
      where: { agentId: agent.id, recordedAt: { gte: day.start, lt: day.end } },
      orderBy: { recordedAt: "desc" },
      take: 120,
    }),
    workerDb.fieldForceSetting.findUnique({
      where: { organizationId: session.org },
      select: { gpsRefreshSeconds: true },
    }),
  ])
  rows.reverse()
  return NextResponse.json({
    success: true,
    data: {
      date: day.value,
      timezone: "UTC",
      gpsIntervalSeconds: settings?.gpsRefreshSeconds ?? 15,
      distanceMeters: distanceMeters(rows),
      locations: rows.map(shapeLocation),
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  const parsed = locationSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const agent = await currentAgent(session.org, session.sub)
  if (!agent) return NextResponse.json({ error: "field_agent_not_found" }, { status: 403 })

  const location = await workerDb.agentLocation.upsert({
    where: { agentId_clientLocationId: { agentId: agent.id, clientLocationId: parsed.data.clientLocationId } },
    update: {},
    create: {
      agentId: agent.id,
      clientLocationId: parsed.data.clientLocationId,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracyM: parsed.data.accuracy ?? null,
      recordedAt: new Date(parsed.data.recordedAt),
    },
  })
  return NextResponse.json({ success: true, data: { location: shapeLocation(location) } })
}
