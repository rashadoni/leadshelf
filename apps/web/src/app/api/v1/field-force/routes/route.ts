import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ADMIN_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR"])

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  agentId: z.string().min(1).nullable().optional(),
  storeIds: z.array(z.string().min(1)).min(1).max(100),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ADMIN_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const uniqueStoreIds = [...new Set(parsed.data.storeIds)]
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
        })),
      },
    },
    select: { id: true },
  })

  return NextResponse.json(route, { status: 201 })
}
