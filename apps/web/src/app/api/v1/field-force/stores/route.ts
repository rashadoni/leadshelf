import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!FIELD_FORCE_ROLES.has(session.role)) return forbidden()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(300, Math.max(1, Number.parseInt(searchParams.get("limit") || "200", 10)))
  const query = (searchParams.get("q") || "").trim()

  const stores = await workerDb.store.findMany({
    where: {
      organizationId: session.org,
      isActive: true,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { code: { contains: query, mode: "insensitive" } },
              { address: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      latitude: true,
      longitude: true,
      format: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ success: true, data: { stores, total: stores.length, limit } })
}
