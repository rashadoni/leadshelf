import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import { createOrder, OrderRepoError } from "../repos/orders.ts"

const prisma = createSystemClient("orders-repo-test")
const slug = `test-orders-${Date.now()}`
let orgId: string
let storeId: string
let productId: string
let userId: string
let deviceId: string
let visitId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Orders Test", slug } })
  orgId = org.id
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "Agent", role: "FIELD_AGENT", employeeCode: "ORD-1" },
  })
  userId = user.id
  const device = await prisma.mobileDevice.create({ data: { userId, platform: "expo" } })
  deviceId = device.id
  const store = await prisma.store.create({ data: { organizationId: orgId, name: "Apteka 1", code: "O1" } })
  storeId = store.id
  const agent = await prisma.fieldAgent.create({
    data: { organizationId: orgId, userId, employeeCode: "A-1" },
  })
  const visit = await prisma.visit.create({
    data: { organizationId: orgId, agentId: agent.id, storeId, status: "IN_PROGRESS", checkInAt: new Date() },
  })
  visitId = visit.id
  const product = await prisma.product.create({
    data: { organizationId: orgId, sku: "SKU-ORDER", name: "Order Product", isActive: true },
  })
  productId = product.id
  await prisma.priceSnapshot.create({
    data: {
      organizationId: orgId,
      productId,
      storeId: null,
      date: new Date("2026-07-04T00:00:00.000Z"),
      price: 10,
    },
  })
  await prisma.creditLimit.create({ data: { storeId, limitAmount: 100, usedAmount: 0 } })
  await prisma.promotion.create({
    data: {
      organizationId: orgId,
      name: "Order promo",
      kind: "PERCENT_DISCOUNT",
      config: { discountPercent: 10 },
      activeFrom: new Date("2026-01-01T00:00:00.000Z"),
      products: { create: [{ productId }] },
    },
  })
})

afterAll(async () => {
  await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } })
  await prisma.order.deleteMany({ where: { organizationId: orgId } })
  await prisma.promotionProduct.deleteMany({ where: { promotion: { organizationId: orgId } } })
  await prisma.promotion.deleteMany({ where: { organizationId: orgId } })
  await prisma.creditLimit.deleteMany({ where: { store: { organizationId: orgId } } })
  await prisma.priceSnapshot.deleteMany({ where: { organizationId: orgId } })
  await prisma.visit.deleteMany({ where: { organizationId: orgId } })
  await prisma.fieldAgent.deleteMany({ where: { organizationId: orgId } })
  await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.product.deleteMany({ where: { organizationId: orgId } })
  await prisma.store.deleteMany({ where: { organizationId: orgId } })
  await prisma.user.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("orders repo", () => {
  test("creates order from visit with promo, invoice, credit update, and mobile idempotency", async () => {
    const first = await createOrder(prisma, orgId, {
      storeId,
      visitId,
      userId,
      deviceId,
      clientOpId: "order-op-1",
      lines: [{ productId, quantity: 2 }],
    })

    expect(first).toMatchObject({
      storeId,
      visitId,
      subtotalCents: 2_000,
      discountCents: 200,
      totalCents: 1_800,
      status: "SUBMITTED",
    })
    expect(first.invoiceNumber).toMatch(/^LS-\d{8}-\d{5}$/)

    const order = await prisma.order.findFirstOrThrow({
      where: { id: first.id },
      include: { lines: true },
    })
    expect(order.invoiceHtml).toContain("Invoice")
    expect(order.invoiceHtml).toContain(order.id)
    expect(order.lines[0]).toMatchObject({
      discountPct: 10,
    })
    expect(Number(order.lines[0]!.totalAmount)).toBe(18)

    const credit = await prisma.creditLimit.findUniqueOrThrow({ where: { storeId } })
    expect(Number(credit.usedAmount)).toBe(18)

    const repeated = await createOrder(prisma, orgId, {
      storeId,
      visitId,
      userId,
      deviceId,
      clientOpId: "order-op-1",
      lines: [{ productId, quantity: 2 }],
    })
    expect(repeated.id).toBe(first.id)
    const afterRepeat = await prisma.creditLimit.findUniqueOrThrow({ where: { storeId } })
    expect(Number(afterRepeat.usedAmount)).toBe(18)
  })

  test("rejects orders that exceed credit limit", async () => {
    await prisma.creditLimit.update({ where: { storeId }, data: { limitAmount: 20, usedAmount: 5 } })

    await expect(
      createOrder(prisma, orgId, {
        storeId,
        visitId,
        userId,
        deviceId,
        clientOpId: "order-op-2",
        lines: [{ productId, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(OrderRepoError)

    await expect(
      createOrder(prisma, orgId, {
        storeId,
        visitId,
        userId,
        deviceId,
        clientOpId: "order-op-2",
        lines: [{ productId, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "credit_limit_exceeded" })
    const credit = await prisma.creditLimit.findUniqueOrThrow({ where: { storeId } })
    expect(Number(credit.usedAmount)).toBe(5)
  })

  test("reserves credit atomically for concurrent orders", async () => {
    await prisma.creditLimit.update({ where: { storeId }, data: { limitAmount: 20, usedAmount: 0 } })

    const results = await Promise.allSettled([
      createOrder(prisma, orgId, {
        storeId,
        visitId,
        userId,
        deviceId,
        clientOpId: "order-op-race-a",
        lines: [{ productId, quantity: 2 }],
      }),
      createOrder(prisma, orgId, {
        storeId,
        visitId,
        userId,
        deviceId,
        clientOpId: "order-op-race-b",
        lines: [{ productId, quantity: 2 }],
      }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected).toMatchObject({ reason: { code: "credit_limit_exceeded" } })

    const credit = await prisma.creditLimit.findUniqueOrThrow({ where: { storeId } })
    expect(Number(credit.usedAmount)).toBe(18)
    const createdOrders = await prisma.order.count({
      where: { organizationId: orgId, clientOpId: { in: ["order-op-race-a", "order-op-race-b"] } },
    })
    expect(createdOrders).toBe(1)
  })
})
