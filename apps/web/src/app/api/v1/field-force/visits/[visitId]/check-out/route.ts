import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const { visitId } = await params
  const visit = await workerDb.visit.findFirst({
    where: { id: visitId, organizationId: session.org },
    select: { id: true, status: true, agent: { select: { userId: true } } },
  })
  if (!visit) return NextResponse.json({ error: "visit_not_found" }, { status: 404 })
  if (session.role === "MERCHANDISER" || session.role === "STORE_STAFF") {
    if (visit.agent.userId !== session.sub) return forbidden()
  }
  if (visit.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "visit_not_in_progress" }, { status: 409 })
  }

  const updated = await workerDb.visit.update({
    where: { id: visit.id },
    data: { status: "COMPLETED", checkOutAt: new Date() },
    select: { id: true, status: true, checkOutAt: true },
  })
  return NextResponse.json(updated)
}
