import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { requireFieldBffSession, workerDb } = vi.hoisted(() => ({
  requireFieldBffSession: vi.fn(),
  workerDb: {
    fieldAgent: { findFirst: vi.fn() },
    order: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    promotion: { count: vi.fn() },
  },
}))

vi.mock("@/server/field-bff/auth", () => ({ requireFieldBffSession }))
vi.mock("@/server/db/client", () => ({ workerDb }))

import { POST } from "./route"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/internal/field/kpi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("trusted Field BFF personal KPI route", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"))
    vi.clearAllMocks()
    requireFieldBffSession.mockResolvedValue({
      ok: true,
      session: { org: "org-1", sub: "user-1", did: "device-1", role: "FIELD_AGENT" },
    })
    workerDb.fieldAgent.findFirst.mockResolvedValue({ id: "field-agent-1" })
    workerDb.order.findMany.mockResolvedValue([])
    workerDb.task.findMany.mockResolvedValue([])
    workerDb.promotion.count.mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not query commercial data when the federation boundary rejects the request", async () => {
    const denied = NextResponse.json({ error: "field_bff_unauthorized" }, { status: 401 })
    requireFieldBffSession.mockResolvedValue({ ok: false, response: denied })

    expect(await POST(request({}))).toBe(denied)
    expect(workerDb.fieldAgent.findFirst).not.toHaveBeenCalled()
  })

  it("rejects malformed or oversized periods", async () => {
    const response = await POST(request({
      protocolVersion: 2,
      period: "month",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    }))

    expect(response.status).toBe(400)
    expect(workerDb.order.findMany).not.toHaveBeenCalled()
  })

  it("returns scoped order, promotion and shelf-task numerators and denominators", async () => {
    workerDb.order.findMany.mockResolvedValue([
      {
        id: "order-delivered",
        status: "DELIVERED",
        currency: "AZN",
        totalAmount: "120.50",
        discountAmount: "10.25",
        appliedPromotions: [{ id: "promo-1" }],
        createdAt: new Date("2026-07-14T09:00:00.000Z"),
        lines: [{ promotionId: "promo-1" }],
      },
      {
        id: "order-submitted",
        status: "SUBMITTED",
        currency: "AZN",
        totalAmount: "40",
        discountAmount: "0",
        appliedPromotions: [],
        createdAt: new Date("2026-07-15T09:00:00.000Z"),
        lines: [{ promotionId: null }],
      },
      {
        id: "order-cancelled",
        status: "CANCELLED",
        currency: "USD",
        totalAmount: "999",
        discountAmount: "99",
        appliedPromotions: [],
        createdAt: new Date("2026-07-15T10:00:00.000Z"),
        lines: [],
      },
    ])
    workerDb.task.findMany.mockResolvedValue([
      { id: "shelf-done", status: "COMPLETED", dueAt: new Date("2026-07-14T10:00:00.000Z"), completedAt: new Date("2026-07-14T11:00:00.000Z") },
      { id: "shelf-late", status: "IN_PROGRESS", dueAt: new Date("2026-07-14T10:00:00.000Z"), completedAt: null },
    ])
    workerDb.promotion.count.mockResolvedValue(3)

    const response = await POST(request({
      protocolVersion: 2,
      period: "week",
      from: "2026-07-12T20:00:00.000Z",
      to: "2026-07-19T20:00:00.000Z",
    }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(workerDb.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        agentId: "field-agent-1",
      }),
    }))
    expect(json.data).toMatchObject({
      source: "LEADSHELF",
      orders: {
        total: 3,
        placed: 2,
        delivered: 1,
        cancelled: 1,
        amounts: [{ currency: "AZN", totalAmount: 160.5, discountAmount: 10.25 }],
        fulfillment: { numerator: 1, denominator: 2, percentage: 50 },
      },
      promotions: {
        active: 3,
        ordersWithPromotion: 1,
        distinctApplied: 1,
        adoption: { numerator: 1, denominator: 2, percentage: 50 },
      },
      shelfTasks: {
        assigned: 2,
        completed: 1,
        overdue: 1,
        completion: { numerator: 1, denominator: 2, percentage: 50 },
        overdueIds: ["shelf-late"],
      },
    })
  })
})
