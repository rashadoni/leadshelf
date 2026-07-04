import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

const bodySchema = z.object({
  agentId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(5000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const agent = await workerDb.fieldAgent.findFirst({
    where: { id: parsed.data.agentId, organizationId: session.org },
    select: { id: true, userId: true },
  })
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 })
  if (session.role === "MERCHANDISER" || session.role === "STORE_STAFF") {
    if (agent.userId !== session.sub) return forbidden()
  }

  const location = await workerDb.agentLocation.create({
    data: {
      agentId: agent.id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracyM: parsed.data.accuracyM ?? null,
      recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
    },
    select: { id: true, recordedAt: true },
  })

  return NextResponse.json(location, { status: 201 })
}
