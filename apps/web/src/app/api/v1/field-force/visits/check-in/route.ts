import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { evaluateVisitGeofence } from "@leadshelf/core"
import { emitProductEvent } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

const bodySchema = z.object({
  agentId: z.string().min(1),
  storeId: z.string().min(1),
  routeStopId: z.string().min(1).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceLimitM: z.number().int().min(25).max(2000).default(150),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const [agent, store, routeStop] = await Promise.all([
    workerDb.fieldAgent.findFirst({
      where: { id: parsed.data.agentId, organizationId: session.org },
      select: { id: true, userId: true },
    }),
    workerDb.store.findFirst({
      where: { id: parsed.data.storeId, organizationId: session.org, isActive: true },
      select: { id: true, latitude: true, longitude: true },
    }),
    parsed.data.routeStopId
      ? workerDb.routeStop.findFirst({
          where: {
            id: parsed.data.routeStopId,
            storeId: parsed.data.storeId,
            route: { organizationId: session.org },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (!store) return NextResponse.json({ error: "store_not_found" }, { status: 404 })
  if (parsed.data.routeStopId && !routeStop) return NextResponse.json({ error: "route_stop_not_found" }, { status: 404 })
  if (session.role === "MERCHANDISER" || session.role === "STORE_STAFF") {
    if (agent.userId !== session.sub) return forbidden()
  }

  const geofence = evaluateVisitGeofence({
    store: store.latitude !== null && store.longitude !== null ? { latitude: store.latitude, longitude: store.longitude } : null,
    checkIn: { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
    limitM: parsed.data.geofenceLimitM,
  })
  const anomalyFlags = {
    geofence: {
      distanceM: geofence.distanceM,
      limitM: geofence.limitM,
      outside: geofence.outside,
    },
  }
  const activeVisit = await workerDb.visit.findFirst({
    where: {
      organizationId: session.org,
      agentId: agent.id,
      storeId: store.id,
      routeStopId: routeStop?.id ?? null,
      status: "IN_PROGRESS",
    },
    select: { id: true, status: true, anomalyFlags: true },
  })
  if (activeVisit) return NextResponse.json(activeVisit)

  const visit = await workerDb.visit.create({
    data: {
      organizationId: session.org,
      agentId: agent.id,
      storeId: store.id,
      routeStopId: routeStop?.id,
      status: "IN_PROGRESS",
      checkInAt: new Date(),
      checkInLat: parsed.data.latitude,
      checkInLng: parsed.data.longitude,
      anomalyFlags,
    },
    select: { id: true, status: true, anomalyFlags: true },
  })

  await workerDb.agentLocation.create({
    data: {
      agentId: agent.id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      recordedAt: new Date(),
    },
  })

  if (geofence.outside) {
    await emitProductEvent(workerDb, session.org, {
      kind: "visit.anomaly",
      severity: "critical",
      storeId: store.id,
      entityType: "visit",
      entityId: visit.id,
      dedupeKey: `visit.anomaly:${visit.id}:geofence`,
      payload: {
        title: "Geofence breach",
        distanceM: geofence.distanceM,
        limitM: geofence.limitM,
      },
    })
  }

  return NextResponse.json(visit, { status: 201 })
}
