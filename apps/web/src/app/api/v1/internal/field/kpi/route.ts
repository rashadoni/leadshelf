import { NextResponse, type NextRequest } from "next/server"
import { requireFieldBffSession } from "@/server/field-bff/auth"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const MAX_RANGE_MS = 40 * 24 * 60 * 60 * 1_000
const PLACED_ORDER_STATUSES = new Set(["SUBMITTED", "CONFIRMED", "DELIVERED"])
const TERMINAL_TASK_STATUSES = new Set(["COMPLETED", "EMPTY"])

type KpiRequest = {
  protocolVersion?: unknown
  period?: unknown
  from?: unknown
  to?: unknown
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : 0
}

function decimalNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseRequest(body: KpiRequest): {
  period: "week" | "month"
  from: Date
  to: Date
} | null {
  if (body.protocolVersion !== 2) return null
  if (body.period !== "week" && body.period !== "month") return null
  if (typeof body.from !== "string" || typeof body.to !== "string") return null
  const from = new Date(body.from)
  const to = new Date(body.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const duration = to.getTime() - from.getTime()
  if (duration <= 0 || duration > MAX_RANGE_MS) return null
  return { period: body.period, from, to }
}

function hasAppliedPromotion(order: {
  appliedPromotions: unknown
  lines: Array<{ promotionId: string | null }>
}): boolean {
  return order.lines.some((line) => line.promotionId != null) ||
    (Array.isArray(order.appliedPromotions) && order.appliedPromotions.length > 0)
}

export async function POST(req: NextRequest) {
  const auth = await requireFieldBffSession(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null) as KpiRequest | null
  const range = body ? parseRequest(body) : null
  if (!range) {
    return NextResponse.json({ error: "invalid_kpi_range" }, { status: 400 })
  }

  const fieldAgent = await workerDb.fieldAgent.findFirst({
    where: { organizationId: auth.session.org, userId: auth.session.sub },
    select: { id: true },
  })
  if (!fieldAgent) {
    return NextResponse.json({ error: "field_agent_not_found" }, { status: 404 })
  }

  const [orders, tasks, activePromotions] = await Promise.all([
    workerDb.order.findMany({
      where: {
        organizationId: auth.session.org,
        agentId: fieldAgent.id,
        createdAt: { gte: range.from, lt: range.to },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        currency: true,
        totalAmount: true,
        discountAmount: true,
        appliedPromotions: true,
        createdAt: true,
        lines: { select: { promotionId: true } },
      },
    }),
    workerDb.task.findMany({
      where: {
        organizationId: auth.session.org,
        assigneeId: auth.session.sub,
        OR: [
          { createdAt: { gte: range.from, lt: range.to } },
          { dueAt: { gte: range.from, lt: range.to } },
          { completedAt: { gte: range.from, lt: range.to } },
        ],
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, status: true, dueAt: true, completedAt: true },
    }),
    workerDb.promotion.count({
      where: {
        organizationId: auth.session.org,
        isActive: true,
        activeFrom: { lt: range.to },
        OR: [{ activeTo: null }, { activeTo: { gte: range.from } }],
      },
    }),
  ])

  const now = new Date()
  const overdueCutoff = new Date(Math.min(now.getTime(), range.to.getTime()))
  const placedOrders = orders.filter((order) => PLACED_ORDER_STATUSES.has(order.status))
  const deliveredOrders = orders.filter((order) => order.status === "DELIVERED")
  const cancelledOrders = orders.filter((order) => order.status === "CANCELLED")
  const promotionOrders = orders.filter(hasAppliedPromotion)
  const promotionIds = new Set(
    orders.flatMap((order) => order.lines.flatMap((line) => line.promotionId ? [line.promotionId] : [])),
  )
  const completedTasks = tasks.filter((task) => task.status === "COMPLETED")
  const overdueTasks = tasks.filter((task) =>
    task.status === "EXPIRED" || (
      task.dueAt != null &&
      task.dueAt < overdueCutoff &&
      !TERMINAL_TASK_STATUSES.has(task.status)
    ),
  )
  const amounts = [...placedOrders.reduce((byCurrency, order) => {
    const current = byCurrency.get(order.currency) ?? { totalAmount: 0, discountAmount: 0 }
    current.totalAmount += decimalNumber(order.totalAmount)
    current.discountAmount += decimalNumber(order.discountAmount)
    byCurrency.set(order.currency, current)
    return byCurrency
  }, new Map<string, { totalAmount: number; discountAmount: number }>())]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => ({
      currency,
      totalAmount: Math.round(value.totalAmount * 100) / 100,
      discountAmount: Math.round(value.discountAmount * 100) / 100,
    }))

  return NextResponse.json({
    success: true,
    data: {
      source: "LEADSHELF",
      generatedAt: now.toISOString(),
      period: {
        kind: range.period,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      orders: {
        total: orders.length,
        placed: placedOrders.length,
        delivered: deliveredOrders.length,
        cancelled: cancelledOrders.length,
        amounts,
        fulfillment: {
          numerator: deliveredOrders.length,
          denominator: placedOrders.length,
          percentage: percentage(deliveredOrders.length, placedOrders.length),
        },
        ids: orders.map((order) => order.id),
      },
      promotions: {
        active: activePromotions,
        ordersWithPromotion: promotionOrders.length,
        distinctApplied: promotionIds.size,
        adoption: {
          numerator: promotionOrders.length,
          denominator: placedOrders.length,
          percentage: percentage(promotionOrders.length, placedOrders.length),
        },
      },
      shelfTasks: {
        assigned: tasks.length,
        completed: completedTasks.length,
        overdue: overdueTasks.length,
        completion: {
          numerator: completedTasks.length,
          denominator: tasks.length,
          percentage: percentage(completedTasks.length, tasks.length),
        },
        overdueIds: overdueTasks.map((task) => task.id),
      },
    },
  }, { headers: { "Cache-Control": "no-store" } })
}
