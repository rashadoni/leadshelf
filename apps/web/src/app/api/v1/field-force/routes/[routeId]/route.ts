import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import { plannedAtFor, routeStopsHaveVisits } from "@/server/field-force/routes"
import { canAdminFieldForce } from "@/server/field-force/permissions"

export const runtime = "nodejs"

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  agentId: z.string().min(1).nullable().optional(),
  date: z.string().date().nullable().optional(),
  storeIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

  const { routeId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const route = await workerDb.route.findFirst({
    where: { id: routeId, organizationId: session.org },
    select: {
      id: true,
      stops: {
        select: {
          id: true,
          visits: { select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!route) return NextResponse.json({ error: "route_not_found" }, { status: 404 })

  if (parsed.data.agentId) {
    const agent = await workerDb.fieldAgent.findFirst({
      where: { id: parsed.data.agentId, organizationId: session.org },
      select: { id: true },
    })
    if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  }

  const uniqueStoreIds = parsed.data.storeIds ? [...new Set(parsed.data.storeIds)] : null
  if (uniqueStoreIds) {
    if (routeStopsHaveVisits(route.stops)) {
      return NextResponse.json({ error: "route_has_visits" }, { status: 409 })
    }

    const stores = await workerDb.store.findMany({
      where: { id: { in: uniqueStoreIds }, organizationId: session.org, isActive: true },
      select: { id: true },
    })
    if (stores.length !== uniqueStoreIds.length) {
      return NextResponse.json({ error: "store_not_found" }, { status: 404 })
    }
  }

  await workerDb.$transaction(async (tx) => {
    await tx.route.update({
      where: { id: route.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.agentId !== undefined ? { agentId: parsed.data.agentId } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      },
      select: { id: true },
    })

    if (uniqueStoreIds) {
      await tx.routeStop.deleteMany({ where: { routeId: route.id } })
      await tx.routeStop.createMany({
        data: uniqueStoreIds.map((storeId, index) => ({
          routeId: route.id,
          storeId,
          sortOrder: index + 1,
          plannedAt: plannedAtFor(parsed.data.date, index),
        })),
      })
    } else if (parsed.data.date !== undefined) {
      const stops = await tx.routeStop.findMany({
        where: { routeId: route.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true },
      })
      await Promise.all(
        stops.map((stop, index) =>
          tx.routeStop.update({
            where: { id: stop.id },
            data: { plannedAt: plannedAtFor(parsed.data.date, index) },
            select: { id: true },
          }),
        ),
      )
    }
  })

  return NextResponse.json({ success: true, data: { id: route.id } })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

  const { routeId } = await params
  const route = await workerDb.route.findFirst({
    where: { id: routeId, organizationId: session.org },
    select: { id: true },
  })
  if (!route) return NextResponse.json({ error: "route_not_found" }, { status: 404 })

  await workerDb.route.update({
    where: { id: route.id },
    data: { isActive: false },
    select: { id: true },
  })

  return NextResponse.json({ success: true, data: { id: route.id } })
}
