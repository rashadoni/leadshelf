import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { shapeFieldForceRoute } from "@/server/field-force/routes"
import { dateFilterForDay, visitDateWhere } from "@/server/field-force/dates"
import { canAdminFieldForce, canReadFieldForce } from "@/server/field-force/permissions"

export const runtime = "nodejs"

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

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const date = searchParams.get("date") || ""
  const status = searchParams.get("status") || ""
  const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10)))

  const dateFilter = date
    ? dateFilterForDay(new Date(date))
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

  const shaped = routes.map(shapeFieldForceRoute).filter((route) => !status || route.status === status)
  return NextResponse.json({ success: true, data: { routes: shaped, total: shaped.length, page: 1, limit } })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

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
