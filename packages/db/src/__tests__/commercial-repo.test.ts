import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import { createOrder } from "../repos/orders.ts"
import {
  CommercialRepoError,
  createRewardClaim,
  createSalesReturn,
  enrollPromotion,
  getAgentCommercialSnapshot,
  recordPromoInventoryEvent,
  submitPromotionExecution,
} from "../repos/commercial.ts"

const prisma = createSystemClient("commercial-repo-test")
const runId = Date.now().toString()
const slug = `test-commercial-${runId}`
const deviceId = `device-commercial-${runId}`
const promotionExecutionClientId = `promo-execution-${runId}`
const operationId = (prefix: string) => `${prefix}-${runId}`
let organizationId: string
let userId: string
let agentId: string
let storeId: string
let visitId: string
let productId: string
let promotionId: string
let inventoryItemId: string
let rewardItemId: string
let orderId: string
let orderLineId: string

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "Commercial Test", slug },
  })
  organizationId = organization.id
  const user = await prisma.user.create({
    data: {
      organizationId,
      name: "Field Agent",
      employeeCode: `COM-${runId}`,
      role: "FIELD_AGENT",
    },
  })
  userId = user.id
  const agent = await prisma.fieldAgent.create({
    data: { organizationId, userId, employeeCode: "COM-AGENT" },
  })
  agentId = agent.id
  const store = await prisma.store.create({
    data: { organizationId, name: "Commercial Store", code: `COM-${runId}` },
  })
  storeId = store.id
  const visit = await prisma.visit.create({
    data: {
      organizationId,
      agentId,
      storeId,
      status: "IN_PROGRESS",
      checkInAt: new Date("2026-07-16T08:00:00.000Z"),
    },
  })
  visitId = visit.id
  const product = await prisma.product.create({
    data: { organizationId, sku: `COM-SKU-${runId}`, name: "Commercial Product" },
  })
  productId = product.id
  await prisma.priceSnapshot.create({
    data: {
      organizationId,
      productId,
      date: new Date("2026-07-16T00:00:00.000Z"),
      price: 10,
    },
  })
  await prisma.creditLimit.create({
    data: { storeId, limitAmount: 1_000, usedAmount: 0, currency: "AZN" },
  })
  const promotion = await prisma.promotion.create({
    data: {
      organizationId,
      name: "Agent promotion",
      kind: "PERCENT_DISCOUNT",
      config: { discountPercent: 10 },
      activeFrom: new Date("2026-01-01T00:00:00.000Z"),
      activeTo: new Date("2026-12-31T23:59:59.999Z"),
      products: { create: [{ productId }] },
    },
  })
  promotionId = promotion.id
  const inventoryItem = await prisma.promoInventoryItem.create({
    data: {
      organizationId,
      code: `SAMPLE-${runId}`,
      name: "Doctor sample",
      kind: "SAMPLE",
      productId,
    },
  })
  inventoryItemId = inventoryItem.id
  await prisma.rewardAccount.create({
    data: { organizationId, agentId, pointsBalance: 100 },
  })
  const reward = await prisma.rewardCatalogItem.create({
    data: {
      organizationId,
      code: `REWARD-${runId}`,
      name: "Reward mug",
      pointsCost: 30,
      stockQuantity: 2,
    },
  })
  rewardItemId = reward.id
  const order = await createOrder(prisma, organizationId, {
    storeId,
    visitId,
    userId,
    deviceId,
    clientOpId: operationId("order"),
    lines: [{ productId, quantity: 5 }],
  })
  orderId = order.id
  const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId } })
  orderLineId = line.id
})

afterAll(async () => {
  if (organizationId) {
    await prisma.rewardLedgerEntry.deleteMany({ where: { organizationId } })
    await prisma.rewardClaim.deleteMany({ where: { organizationId } })
    await prisma.rewardAccount.deleteMany({ where: { organizationId } })
    await prisma.rewardCatalogItem.deleteMany({ where: { organizationId } })
    await prisma.salesReturnLine.deleteMany({ where: { salesReturn: { organizationId } } })
    await prisma.salesReturn.deleteMany({ where: { organizationId } })
    await prisma.promoInventoryEvent.deleteMany({ where: { organizationId } })
    await prisma.promoInventoryItem.deleteMany({ where: { organizationId } })
    await prisma.promotionExecution.deleteMany({ where: { organizationId } })
    await prisma.orderLine.deleteMany({ where: { order: { organizationId } } })
    await prisma.order.deleteMany({ where: { organizationId } })
    await prisma.promotionProduct.deleteMany({ where: { promotion: { organizationId } } })
    await prisma.promotion.deleteMany({ where: { organizationId } })
    await prisma.creditLimit.deleteMany({ where: { store: { organizationId } } })
    await prisma.priceSnapshot.deleteMany({ where: { organizationId } })
    await prisma.visit.deleteMany({ where: { organizationId } })
    await prisma.fieldAgent.deleteMany({ where: { organizationId } })
    await prisma.product.deleteMany({ where: { organizationId } })
    await prisma.store.deleteMany({ where: { organizationId } })
    await prisma.user.deleteMany({ where: { organizationId } })
    await prisma.organization.delete({ where: { id: organizationId } })
  }
  await prisma.$disconnect()
})

describe("commercial execution repo", () => {
  test("enrolls, submits, and replays promotion execution", async () => {
    const enrolled = await enrollPromotion(prisma, organizationId, userId, {
      promotionId,
      storeId,
      visitId,
      clientExecutionId: promotionExecutionClientId,
      note: "Discussed with pharmacist",
    })
    expect(enrolled).toMatchObject({
      promotionId,
      storeId,
      visitId,
      status: "ENROLLED",
    })

    const replay = await enrollPromotion(prisma, organizationId, userId, {
      promotionId,
      storeId,
      visitId,
      clientExecutionId: promotionExecutionClientId,
    })
    expect(replay.id).toBe(enrolled.id)

    const submitted = await submitPromotionExecution(prisma, organizationId, userId, {
      clientExecutionId: promotionExecutionClientId,
      proofPhotoUrl: "commercial/promo/proof-1.jpg",
    })
    expect(submitted).toMatchObject({
      id: enrolled.id,
      status: "SUBMITTED",
      proofPhotoUrl: "commercial/promo/proof-1.jpg",
    })
    expect(await prisma.promotionExecution.count({ where: { organizationId } })).toBe(1)
  })

  test("keeps inventory append-only, idempotent, and non-negative", async () => {
    const received = await recordPromoInventoryEvent(prisma, organizationId, userId, {
      itemId: inventoryItemId,
      eventType: "RECEIVE",
      quantity: 10,
      recordedAt: new Date("2026-07-16T08:10:00.000Z"),
      clientDeviceId: deviceId,
      clientOpId: operationId("inventory-receive"),
    })
    expect(received.quantityDelta).toBe(10)

    const replay = await recordPromoInventoryEvent(prisma, organizationId, userId, {
      itemId: inventoryItemId,
      eventType: "RECEIVE",
      quantity: 10,
      recordedAt: new Date("2026-07-16T08:10:00.000Z"),
      clientDeviceId: deviceId,
      clientOpId: operationId("inventory-receive"),
    })
    expect(replay.id).toBe(received.id)

    await recordPromoInventoryEvent(prisma, organizationId, userId, {
      itemId: inventoryItemId,
      eventType: "ISSUE",
      quantity: 4,
      storeId,
      visitId,
      recordedAt: new Date("2026-07-16T08:20:00.000Z"),
      clientDeviceId: deviceId,
      clientOpId: operationId("inventory-issue"),
    })
    const counted = await recordPromoInventoryEvent(prisma, organizationId, userId, {
      itemId: inventoryItemId,
      eventType: "COUNT_ADJUSTMENT",
      countedBalance: 5,
      reason: "physical_count",
      recordedAt: new Date("2026-07-16T08:30:00.000Z"),
      clientDeviceId: deviceId,
      clientOpId: operationId("inventory-count"),
    })
    expect(counted.quantityDelta).toBe(-1)

    await expect(recordPromoInventoryEvent(prisma, organizationId, userId, {
      itemId: inventoryItemId,
      eventType: "RETURN",
      quantity: 6,
      reason: "return_to_office",
      recordedAt: new Date("2026-07-16T08:40:00.000Z"),
      clientDeviceId: deviceId,
      clientOpId: operationId("inventory-return"),
    })).rejects.toMatchObject({ code: "inventory_balance_insufficient" })

    const total = await prisma.promoInventoryEvent.aggregate({
      where: { organizationId, agentId, itemId: inventoryItemId },
      _sum: { quantityDelta: true },
    })
    expect(Number(total._sum.quantityDelta)).toBe(5)
    expect(await prisma.promoInventoryEvent.count({ where: { organizationId } })).toBe(3)
  })

  test("creates an idempotent return and prevents over-return", async () => {
    const created = await createSalesReturn(prisma, organizationId, userId, {
      orderId,
      visitId,
      reason: "DAMAGED",
      note: "Damaged package",
      lines: [{ orderLineId, quantity: 2 }],
      clientDeviceId: deviceId,
      clientOpId: operationId("sales-return-1"),
    })
    expect(created).toMatchObject({
      orderId,
      storeId,
      visitId,
      status: "SUBMITTED",
      lines: [{ orderLineId, productId, quantity: 2 }],
    })

    const replay = await createSalesReturn(prisma, organizationId, userId, {
      orderId,
      reason: "DAMAGED",
      lines: [{ orderLineId, quantity: 2 }],
      clientDeviceId: deviceId,
      clientOpId: operationId("sales-return-1"),
    })
    expect(replay.id).toBe(created.id)

    await expect(createSalesReturn(prisma, organizationId, userId, {
      orderId,
      reason: "EXPIRED",
      lines: [{ orderLineId, quantity: 4 }],
      clientDeviceId: deviceId,
      clientOpId: operationId("sales-return-2"),
    })).rejects.toMatchObject({ code: "return_quantity_exceeded" })
    expect(await prisma.salesReturn.count({ where: { organizationId } })).toBe(1)
  })

  test("reserves reward points and stock once", async () => {
    const first = await createRewardClaim(prisma, organizationId, userId, {
      rewardItemId,
      quantity: 2,
      note: "Team reward",
      clientDeviceId: deviceId,
      clientOpId: operationId("reward-claim-1"),
    })
    expect(first).toMatchObject({ rewardItemId, quantity: 2, pointsCost: 60, status: "SUBMITTED" })

    const replay = await createRewardClaim(prisma, organizationId, userId, {
      rewardItemId,
      quantity: 2,
      clientDeviceId: deviceId,
      clientOpId: operationId("reward-claim-1"),
    })
    expect(replay.id).toBe(first.id)

    const account = await prisma.rewardAccount.findFirstOrThrow({ where: { organizationId, agentId } })
    const item = await prisma.rewardCatalogItem.findFirstOrThrow({ where: { id: rewardItemId } })
    expect(account.pointsBalance).toBe(40)
    expect(item.stockQuantity).toBe(0)
    expect(await prisma.rewardLedgerEntry.count({ where: { organizationId } })).toBe(1)

    await expect(createRewardClaim(prisma, organizationId, userId, {
      rewardItemId,
      quantity: 1,
      clientDeviceId: deviceId,
      clientOpId: operationId("reward-claim-2"),
    })).rejects.toBeInstanceOf(CommercialRepoError)
    const afterFailure = await prisma.rewardAccount.findFirstOrThrow({ where: { organizationId, agentId } })
    expect(afterFailure.pointsBalance).toBe(40)
  })

  test("returns an agent-scoped commercial snapshot with server order status", async () => {
    const snapshot = await getAgentCommercialSnapshot(
      prisma,
      organizationId,
      userId,
      new Date("2026-07-16T10:00:00.000Z"),
    )
    expect(snapshot.version).toBe(1)
    expect(snapshot.promotions).toEqual([expect.objectContaining({ id: promotionId })])
    expect(snapshot.promotionExecutions).toEqual([
      expect.objectContaining({ clientExecutionId: promotionExecutionClientId, status: "SUBMITTED" }),
    ])
    expect(snapshot.inventory.items).toEqual([
      expect.objectContaining({ id: inventoryItemId, balance: 5 }),
    ])
    expect(snapshot.orders).toEqual([
      expect.objectContaining({ id: orderId, status: "SUBMITTED", storeId }),
    ])
    expect(snapshot.returns).toEqual([
      expect.objectContaining({ orderId, status: "SUBMITTED" }),
    ])
    expect(snapshot.rewards).toMatchObject({ balance: 40 })
  })
})
