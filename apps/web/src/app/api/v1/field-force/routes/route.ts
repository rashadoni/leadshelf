import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ADMIN_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR"])

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  agentId: z.string().min(1).nullable().optional(),
  date: z.string().date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  storeIds: z.array(z.string().min(1)).max(100).optional(),
  points: z.array(z.object({
    customerId: z.string().min(1),
    plannedTime: z.string().datetime().nullable().optional(),
  })).max(100).optional(),
}).refine((value) => (value.storeIds?.length ?? 0) > 0 || (value.points?.length ?? 0) > 0, {
  message: "storeIds_or_points_required",
})

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function visitDateWhere(dateFilter: { gte: Date; lt: Date } | null) {
  if (!dateFilter) return {}
  return {
    OR: [
      { createdAt: dateFilter },
      { checkInAt: dateFilter },
      { checkOutAt: dateFilter },
      { routeStop: { plannedAt: dateFilter } },
    ],
  }
}

function shapeRoute(route: any) {
  const points = [...route.stops]
    .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
    .map((stop: any, index: number) => {
      const completedVisit = stop.visits?.find((visit: any) => visit.status === "COMPLETED")
      const skippedVisit = stop.visits?.find((visit: any) => visit.status === "SKIPPED")
      const inProgressVisit = stop.visits?.find((visit: any) => visit.status === "IN_PROGRESS")
      return {
        id: stop.id,
        customerId: stop.storeId,
        orderIndex: index,
        status: completedVisit ? "VISITED" : skippedVisit ? "SKIPPED" : "PENDING",
        plannedTime: stop.plannedAt,
        visitedAt: completedVisit?.checkOutAt ?? inProgressVisit?.checkInAt ?? null,
        customer: {
          id: stop.store.id,
          name: stop.store.name,
          code: stop.store.code,
          address: stop.store.address,
          latitude: stop.store.latitude,
          longitude: stop.store.longitude,
        },
      }
    })
  const totalPoints = points.length
  const visitedPoints = points.filter((point: any) => point.status === "VISITED").length
  const hasInProgress = route.stops.some((stop: any) => stop.visits?.some((visit: any) => visit.status === "IN_PROGRESS"))
  const status = !route.isActive ? "CANCELLED" : totalPoints > 0 && visitedPoints === totalPoints ? "COMPLETED" : hasInProgress ? "IN_PROGRESS" : "PLANNED"
  const plannedDates = route.stops.map((stop: any) => stop.plannedAt).filter(Boolean)
  const date = plannedDates[0] ?? route.createdAt
  return {
    id: route.id,
    name: route.name,
    agentId: route.agentId,
    date,
    status,
    totalPoints,
    visitedPoints,
    startedAt: route.stops.flatMap((stop: any) => stop.visits ?? []).find((visit: any) => visit.checkInAt)?.checkInAt ?? null,
    completedAt: status === "COMPLETED" ? route.stops.flatMap((stop: any) => stop.visits ?? []).at(-1)?.checkOutAt ?? null : null,
    notes: null,
    agent: route.agent ? { id: route.agent.id, name: route.agent.user.name } : null,
    points,
  }
}

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ADMIN_ROLES.has(session.role) && session.role !== "MERCHANDISER" && session.role !== "STORE_STAFF") return forbidden()

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const date = searchParams.get("date") || ""
  const status = searchParams.get("status") || ""
  const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10)))

  const dateFilter = date
    ? (() => {
        const start = startOfDay(new Date(date))
        const end = new Date(start)
        end.setDate(end.getDate() + 1)
        return { gte: start, lt: end }
      })()
    : null

  const routes = await workerDb.route.findMany({
    where: {
      organizationId: session.org,
      ...(agentId ? { agentId } : {}),
      ...(dateFilter ? { stops: { some: { plannedAt: dateFilter } } } : {}),
    },
    include: {
      agent: { select: { id: true, user: { select: { name: true } } } },
      stops: {
        orderBy: { sortOrder: "asc" },
        include: {
          store: { select: { id: true, name: true, code: true, address: true, latitude: true, longitude: true } },
          visits: {
            where: visitDateWhere(dateFilter),
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, checkInAt: true, checkOutAt: true, createdAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  const shaped = routes.map(shapeRoute).filter((route) => !status || route.status === status)
  return NextResponse.json({ success: true, data: { routes: shaped, total: shaped.length, page: 1, limit } })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ADMIN_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const uniqueStoreIds = [...new Set(parsed.data.storeIds ?? parsed.data.points?.map((point) => point.customerId) ?? [])]
  const [agent, stores] = await Promise.all([
    parsed.data.agentId
      ? workerDb.fieldAgent.findFirst({
          where: { id: parsed.data.agentId, organizationId: session.org },
          select: { id: true },
        })
      : Promise.resolve(null),
    workerDb.store.findMany({
      where: { id: { in: uniqueStoreIds }, organizationId: session.org, isActive: true },
      select: { id: true },
    }),
  ])

  if (parsed.data.agentId && !agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (stores.length !== uniqueStoreIds.length) {
    return NextResponse.json({ error: "store_not_found" }, { status: 404 })
  }

  const route = await workerDb.route.create({
    data: {
      organizationId: session.org,
      name: parsed.data.name,
      agentId: agent?.id,
      stops: {
        create: uniqueStoreIds.map((storeId, index) => ({
          storeId,
          sortOrder: index + 1,
          plannedAt: parsed.data.points?.[index]?.plannedTime
            ? new Date(parsed.data.points[index]!.plannedTime!)
            : parsed.data.date
              ? new Date(`${parsed.data.date}T09:${String(index).padStart(2, "0")}:00.000Z`)
              : null,
        })),
      },
    },
    select: { id: true },
  })

  return NextResponse.json(route, { status: 201 })
}
