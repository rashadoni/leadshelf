import { NextResponse, type NextRequest } from "next/server"
import { orderCreateRequestSchema } from "@leadshelf/api-contracts/orders/v1"
import { createOrder, OrderRepoError } from "@leadshelf/db"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const ORDER_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "FIELD_AGENT", "STORE_STAFF"])

function errorResponse(error: OrderRepoError) {
  if (error.code === "store_not_found" || error.code === "visit_not_found" || error.code === "product_not_found") {
    return NextResponse.json({ error: error.code, detail: error.detail }, { status: 404 })
  }
  if (error.code === "product_price_missing" || error.code === "visit_store_mismatch") {
    return NextResponse.json({ error: error.code, detail: error.detail }, { status: 422 })
  }
  if (error.code === "credit_limit_exceeded" || error.code === "credit_account_blocked") {
    return NextResponse.json({ error: error.code, detail: error.detail }, { status: 422 })
  }
  return NextResponse.json({ error: error.code, detail: error.detail }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!ORDER_ROLES.has(session.role)) return forbidden()

  const parsed = orderCreateRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const order = await createOrder(workerDb, session.org, {
      ...parsed.data,
      userId: session.sub,
    })
    return NextResponse.json({ order }, { status: 201 })
  } catch (error) {
    if (error instanceof OrderRepoError) return errorResponse(error)
    throw error
  }
}
