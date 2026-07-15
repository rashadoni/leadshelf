import type { PrismaClient } from "@prisma/client"
import { Prisma } from "@prisma/client"

export type CommercialRepoErrorCode =
  | "agent_not_found"
  | "promotion_not_found_or_inactive"
  | "promotion_execution_not_found"
  | "promotion_execution_locked"
  | "store_not_found"
  | "visit_not_found_or_not_self"
  | "inventory_item_not_found"
  | "inventory_balance_insufficient"
  | "inventory_count_reason_required"
  | "order_not_found_or_not_self"
  | "order_not_returnable"
  | "order_line_not_found"
  | "return_quantity_exceeded"
  | "reward_not_found_or_inactive"
  | "reward_account_not_found"
  | "reward_points_insufficient"
  | "reward_stock_insufficient"
  | "idempotency_payload_mismatch"
  | "concurrent_update"

export class CommercialRepoError extends Error {
  constructor(
    public code: CommercialRepoErrorCode,
    public detail?: unknown,
  ) {
    super(code)
    this.name = "CommercialRepoError"
  }
}

export interface PromotionEnrollInput {
  promotionId: string
  storeId: string
  visitId?: string | null
  clientExecutionId: string
  note?: string | null
}

export interface PromotionSubmitInput {
  clientExecutionId: string
  note?: string | null
  proofPhotoUrl?: string | null
}

export interface PromoInventoryRecordInput {
  itemId: string
  eventType: "RECEIVE" | "ISSUE" | "RETURN" | "COUNT_ADJUSTMENT"
  quantity?: number
  countedBalance?: number
  storeId?: string | null
  visitId?: string | null
  reason?: string | null
  note?: string | null
  recordedAt: Date
  clientDeviceId: string
  clientOpId: string
}

export interface SalesReturnCreateInput {
  orderId: string
  visitId?: string | null
  reason: string
  note?: string | null
  evidencePhotoUrl?: string | null
  lines: Array<{ orderLineId: string; quantity: number }>
  clientDeviceId: string
  clientOpId: string
}

export interface RewardClaimCreateInput {
  rewardItemId: string
  quantity: number
  note?: string | null
  clientDeviceId: string
  clientOpId: string
}

export function emptyAgentCommercialSnapshot(now = new Date()) {
  return {
    version: 1 as const,
    generatedAt: now.toISOString(),
    promotions: [],
    promotionExecutions: [],
    inventory: { items: [], events: [] },
    orders: [],
    returns: [],
    rewards: { balance: 0, catalog: [], claims: [], ledger: [] },
  }
}

function decimal(value: Prisma.Decimal | number | string | null | undefined): number {
  return value == null ? 0 : Number(value)
}

function uniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function retryableTransaction(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
}

async function serializable<T>(
  prisma: PrismaClient,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      if (!retryableTransaction(error) || attempt === 2) throw error
    }
  }
  throw new CommercialRepoError("concurrent_update")
}

async function agentForUser(
  prisma: Prisma.TransactionClient | PrismaClient,
  organizationId: string,
  userId: string,
) {
  const agent = await prisma.fieldAgent.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  })
  if (!agent) throw new CommercialRepoError("agent_not_found")
  return agent
}

async function validateStoreAndVisit(
  prisma: Prisma.TransactionClient | PrismaClient,
  input: {
    organizationId: string
    agentId: string
    storeId: string
    visitId?: string | null
  },
): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId, isActive: true },
    select: { id: true },
  })
  if (!store) throw new CommercialRepoError("store_not_found")
  if (!input.visitId) return
  const visit = await prisma.visit.findFirst({
    where: {
      id: input.visitId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      storeId: input.storeId,
    },
    select: { id: true },
  })
  if (!visit) throw new CommercialRepoError("visit_not_found_or_not_self")
}

function promotionExecutionResult(execution: {
  id: string
  clientExecutionId: string
  promotionId: string
  storeId: string
  visitId: string | null
  status: string
  note: string | null
  proofPhotoUrl: string | null
  submittedAt: Date | null
  updatedAt: Date
}) {
  return {
    id: execution.id,
    clientExecutionId: execution.clientExecutionId,
    promotionId: execution.promotionId,
    storeId: execution.storeId,
    visitId: execution.visitId,
    status: execution.status,
    note: execution.note,
    proofPhotoUrl: execution.proofPhotoUrl,
    submittedAt: execution.submittedAt?.toISOString() ?? null,
    updatedAt: execution.updatedAt.toISOString(),
  }
}

export async function enrollPromotion(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  input: PromotionEnrollInput,
) {
  const agent = await agentForUser(prisma, organizationId, userId)
  const existing = await prisma.promotionExecution.findFirst({
    where: { organizationId, clientExecutionId: input.clientExecutionId },
  })
  if (existing) {
    if (
      existing.agentId !== agent.id
      || existing.promotionId !== input.promotionId
      || existing.storeId !== input.storeId
    ) {
      throw new CommercialRepoError("idempotency_payload_mismatch")
    }
    return promotionExecutionResult(existing)
  }

  const now = new Date()
  const promotion = await prisma.promotion.findFirst({
    where: {
      id: input.promotionId,
      organizationId,
      isActive: true,
      activeFrom: { lte: now },
      OR: [{ activeTo: null }, { activeTo: { gte: now } }],
    },
    select: { id: true },
  })
  if (!promotion) throw new CommercialRepoError("promotion_not_found_or_inactive")
  await validateStoreAndVisit(prisma, {
    organizationId,
    agentId: agent.id,
    storeId: input.storeId,
    visitId: input.visitId,
  })

  try {
    const execution = await prisma.promotionExecution.create({
      data: {
        organizationId,
        promotionId: promotion.id,
        agentId: agent.id,
        storeId: input.storeId,
        visitId: input.visitId ?? null,
        clientExecutionId: input.clientExecutionId,
        note: input.note?.trim() || null,
      },
    })
    return promotionExecutionResult(execution)
  } catch (error) {
    if (!uniqueConflict(error)) throw error
    const replay = await prisma.promotionExecution.findFirst({
      where: { organizationId, clientExecutionId: input.clientExecutionId, agentId: agent.id },
    })
    if (!replay) throw error
    return promotionExecutionResult(replay)
  }
}

export async function submitPromotionExecution(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  input: PromotionSubmitInput,
) {
  const agent = await agentForUser(prisma, organizationId, userId)
  const execution = await prisma.promotionExecution.findFirst({
    where: { organizationId, agentId: agent.id, clientExecutionId: input.clientExecutionId },
  })
  if (!execution) throw new CommercialRepoError("promotion_execution_not_found")
  if (execution.status !== "ENROLLED") {
    return promotionExecutionResult(execution)
  }
  if (!input.note?.trim() && !input.proofPhotoUrl?.trim()) {
    throw new CommercialRepoError("promotion_execution_locked", { reason: "proof_required" })
  }

  const updated = await prisma.promotionExecution.updateMany({
    where: { id: execution.id, organizationId, agentId: agent.id, status: "ENROLLED" },
    data: {
      status: "SUBMITTED",
      note: input.note?.trim() || execution.note,
      proofPhotoUrl: input.proofPhotoUrl?.trim() || null,
      submittedAt: new Date(),
    },
  })
  const result = await prisma.promotionExecution.findFirst({
    where: { id: execution.id, organizationId, agentId: agent.id },
  })
  if (!result) throw new CommercialRepoError("promotion_execution_not_found")
  if (updated.count === 0 && result.status === "ENROLLED") {
    throw new CommercialRepoError("concurrent_update")
  }
  return promotionExecutionResult(result)
}

function inventoryEventResult(event: {
  id: string
  itemId: string
  eventType: string
  quantityDelta: Prisma.Decimal
  countedBalance: Prisma.Decimal | null
  storeId: string | null
  visitId: string | null
  reason: string | null
  note: string | null
  recordedAt: Date
}) {
  return {
    id: event.id,
    itemId: event.itemId,
    eventType: event.eventType,
    quantityDelta: decimal(event.quantityDelta),
    countedBalance: event.countedBalance == null ? null : decimal(event.countedBalance),
    storeId: event.storeId,
    visitId: event.visitId,
    reason: event.reason,
    note: event.note,
    recordedAt: event.recordedAt.toISOString(),
  }
}

export async function recordPromoInventoryEvent(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  input: PromoInventoryRecordInput,
) {
  return serializable(prisma, async (tx) => {
    const agent = await agentForUser(tx, organizationId, userId)
    const replay = await tx.promoInventoryEvent.findFirst({
      where: { organizationId, clientDeviceId: input.clientDeviceId, clientOpId: input.clientOpId },
    })
    if (replay) return inventoryEventResult(replay)

    const item = await tx.promoInventoryItem.findFirst({
      where: { id: input.itemId, organizationId, isActive: true },
      select: { id: true },
    })
    if (!item) throw new CommercialRepoError("inventory_item_not_found")
    if (input.storeId) {
      await validateStoreAndVisit(tx, {
        organizationId,
        agentId: agent.id,
        storeId: input.storeId,
        visitId: input.visitId,
      })
    } else if (input.visitId || input.eventType === "ISSUE") {
      throw new CommercialRepoError(input.eventType === "ISSUE" ? "store_not_found" : "visit_not_found_or_not_self")
    }

    const balanceRow = await tx.promoInventoryEvent.aggregate({
      where: { organizationId, agentId: agent.id, itemId: item.id },
      _sum: { quantityDelta: true },
    })
    const currentBalance = decimal(balanceRow._sum.quantityDelta)
    let quantityDelta: number
    let countedBalance: number | null = null
    if (input.eventType === "COUNT_ADJUSTMENT") {
      if (!input.reason?.trim()) throw new CommercialRepoError("inventory_count_reason_required")
      countedBalance = input.countedBalance ?? Number.NaN
      if (!Number.isFinite(countedBalance) || countedBalance < 0) {
        throw new CommercialRepoError("inventory_count_reason_required")
      }
      quantityDelta = countedBalance - currentBalance
    } else {
      const quantity = input.quantity ?? Number.NaN
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new CommercialRepoError("inventory_item_not_found", { reason: "invalid_quantity" })
      }
      quantityDelta = input.eventType === "RECEIVE" ? quantity : -quantity
    }
    if (currentBalance + quantityDelta < 0) {
      throw new CommercialRepoError("inventory_balance_insufficient", {
        currentBalance,
        requestedDelta: quantityDelta,
      })
    }

    const event = await tx.promoInventoryEvent.create({
      data: {
        organizationId,
        itemId: item.id,
        agentId: agent.id,
        storeId: input.storeId ?? null,
        visitId: input.visitId ?? null,
        eventType: input.eventType,
        quantityDelta: new Prisma.Decimal(quantityDelta),
        countedBalance: countedBalance == null ? null : new Prisma.Decimal(countedBalance),
        reason: input.reason?.trim() || null,
        note: input.note?.trim() || null,
        recordedAt: input.recordedAt,
        clientDeviceId: input.clientDeviceId,
        clientOpId: input.clientOpId,
      },
    })
    return inventoryEventResult(event)
  })
}

function salesReturnResult(value: {
  id: string
  orderId: string
  storeId: string
  visitId: string | null
  status: string
  reason: string
  note: string | null
  evidencePhotoUrl: string | null
  submittedAt: Date
  updatedAt: Date
  lines: Array<{
    id: string
    orderLineId: string
    productId: string
    quantity: Prisma.Decimal
    unitAmount: Prisma.Decimal
  }>
}) {
  return {
    id: value.id,
    orderId: value.orderId,
    storeId: value.storeId,
    visitId: value.visitId,
    status: value.status,
    reason: value.reason,
    note: value.note,
    evidencePhotoUrl: value.evidencePhotoUrl,
    submittedAt: value.submittedAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    lines: value.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      productId: line.productId,
      quantity: decimal(line.quantity),
      unitAmount: decimal(line.unitAmount),
    })),
  }
}

export async function createSalesReturn(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  input: SalesReturnCreateInput,
) {
  return serializable(prisma, async (tx) => {
    const agent = await agentForUser(tx, organizationId, userId)
    const replay = await tx.salesReturn.findFirst({
      where: { organizationId, clientDeviceId: input.clientDeviceId, clientOpId: input.clientOpId },
      include: { lines: true },
    })
    if (replay) return salesReturnResult(replay)

    const order = await tx.order.findFirst({
      where: { id: input.orderId, organizationId, agentId: agent.id },
      include: { lines: true },
    })
    if (!order) throw new CommercialRepoError("order_not_found_or_not_self")
    if (!(["SUBMITTED", "CONFIRMED", "DELIVERED"] as string[]).includes(order.status)) {
      throw new CommercialRepoError("order_not_returnable", { status: order.status })
    }
    if (input.visitId) {
      await validateStoreAndVisit(tx, {
        organizationId,
        agentId: agent.id,
        storeId: order.storeId,
        visitId: input.visitId,
      })
    }

    const requested = new Map<string, number>()
    for (const line of input.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new CommercialRepoError("order_line_not_found", { reason: "invalid_quantity" })
      }
      requested.set(line.orderLineId, (requested.get(line.orderLineId) ?? 0) + line.quantity)
    }
    if (requested.size === 0) throw new CommercialRepoError("order_line_not_found")
    const orderLines = new Map(order.lines.map((line) => [line.id, line]))
    const requestedIds = [...requested.keys()]
    if (requestedIds.some((id) => !orderLines.has(id))) {
      throw new CommercialRepoError("order_line_not_found")
    }
    const alreadyReturned = await tx.salesReturnLine.groupBy({
      by: ["orderLineId"],
      where: {
        orderLineId: { in: requestedIds },
        salesReturn: {
          organizationId,
          orderId: order.id,
          status: { in: ["SUBMITTED", "APPROVED", "RECEIVED"] },
        },
      },
      _sum: { quantity: true },
    })
    const returnedByLine = new Map(alreadyReturned.map((row) => [row.orderLineId, decimal(row._sum.quantity)]))
    for (const [orderLineId, quantity] of requested) {
      const source = orderLines.get(orderLineId)!
      const remaining = decimal(source.quantity) - (returnedByLine.get(orderLineId) ?? 0)
      if (quantity > remaining) {
        throw new CommercialRepoError("return_quantity_exceeded", { orderLineId, remaining })
      }
    }

    const salesReturn = await tx.salesReturn.create({
      data: {
        organizationId,
        orderId: order.id,
        agentId: agent.id,
        storeId: order.storeId,
        visitId: input.visitId ?? order.visitId,
        reason: input.reason.trim(),
        note: input.note?.trim() || null,
        evidencePhotoUrl: input.evidencePhotoUrl?.trim() || null,
        clientDeviceId: input.clientDeviceId,
        clientOpId: input.clientOpId,
      },
    })
    await tx.salesReturnLine.createMany({
      data: [...requested].map(([orderLineId, quantity]) => {
        const source = orderLines.get(orderLineId)!
        return {
          salesReturnId: salesReturn.id,
          orderLineId,
          productId: source.productId,
          quantity: new Prisma.Decimal(quantity),
          unitAmount: source.unitPrice,
        }
      }),
    })
    const result = await tx.salesReturn.findFirstOrThrow({
      where: { id: salesReturn.id, organizationId, agentId: agent.id },
      include: { lines: true },
    })
    return salesReturnResult(result)
  })
}

function rewardClaimResult(value: {
  id: string
  rewardItemId: string
  status: string
  quantity: number
  pointsCost: number
  note: string | null
  submittedAt: Date
  updatedAt: Date
}) {
  return {
    id: value.id,
    rewardItemId: value.rewardItemId,
    status: value.status,
    quantity: value.quantity,
    pointsCost: value.pointsCost,
    note: value.note,
    submittedAt: value.submittedAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  }
}

export async function createRewardClaim(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  input: RewardClaimCreateInput,
) {
  return serializable(prisma, async (tx) => {
    const agent = await agentForUser(tx, organizationId, userId)
    const replay = await tx.rewardClaim.findFirst({
      where: { organizationId, clientDeviceId: input.clientDeviceId, clientOpId: input.clientOpId },
    })
    if (replay) return rewardClaimResult(replay)

    const reward = await tx.rewardCatalogItem.findFirst({
      where: { id: input.rewardItemId, organizationId, isActive: true },
    })
    if (!reward) throw new CommercialRepoError("reward_not_found_or_inactive")
    const account = await tx.rewardAccount.findFirst({
      where: { organizationId, agentId: agent.id },
    })
    if (!account) throw new CommercialRepoError("reward_account_not_found")
    const totalCost = reward.pointsCost * input.quantity
    const points = await tx.rewardAccount.updateMany({
      where: { id: account.id, organizationId, pointsBalance: { gte: totalCost } },
      data: { pointsBalance: { decrement: totalCost } },
    })
    if (points.count !== 1) throw new CommercialRepoError("reward_points_insufficient")
    if (reward.stockQuantity != null) {
      const stock = await tx.rewardCatalogItem.updateMany({
        where: {
          id: reward.id,
          organizationId,
          isActive: true,
          stockQuantity: { gte: input.quantity },
        },
        data: { stockQuantity: { decrement: input.quantity } },
      })
      if (stock.count !== 1) throw new CommercialRepoError("reward_stock_insufficient")
    }
    const claim = await tx.rewardClaim.create({
      data: {
        organizationId,
        accountId: account.id,
        rewardItemId: reward.id,
        quantity: input.quantity,
        pointsCost: totalCost,
        note: input.note?.trim() || null,
        clientDeviceId: input.clientDeviceId,
        clientOpId: input.clientOpId,
      },
    })
    await tx.rewardLedgerEntry.create({
      data: {
        organizationId,
        accountId: account.id,
        pointsDelta: -totalCost,
        reason: "reward_claim_submitted",
        sourceType: "reward.claim",
        sourceId: claim.id,
      },
    })
    return rewardClaimResult(claim)
  })
}

export async function getAgentCommercialSnapshot(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  now = new Date(),
) {
  const agent = await agentForUser(prisma, organizationId, userId)
  const [promotions, executions, items, balances, inventoryEvents, orders, salesReturns, rewardAccount, rewards] = await Promise.all([
    prisma.promotion.findMany({
      where: {
        organizationId,
        isActive: true,
        activeFrom: { lte: now },
        OR: [{ activeTo: null }, { activeTo: { gte: now } }],
      },
      orderBy: [{ activeTo: "asc" }, { name: "asc" }],
      take: 100,
      include: { products: { select: { productId: true } } },
    }),
    prisma.promotionExecution.findMany({
      where: { organizationId, agentId: agent.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.promoInventoryItem.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.promoInventoryEvent.groupBy({
      by: ["itemId"],
      where: { organizationId, agentId: agent.id },
      _sum: { quantityDelta: true },
    }),
    prisma.promoInventoryEvent.findMany({
      where: { organizationId, agentId: agent.id },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.order.findMany({
      where: { organizationId, agentId: agent.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        store: { select: { name: true } },
        lines: {
          include: { product: { select: { name: true, sku: true } } },
          orderBy: { id: "asc" },
        },
      },
    }),
    prisma.salesReturn.findMany({
      where: { organizationId, agentId: agent.id },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
      include: { lines: true },
    }),
    prisma.rewardAccount.findFirst({
      where: { organizationId, agentId: agent.id },
      include: {
        claims: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 100 },
        ledgerEntries: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 },
      },
    }),
    prisma.rewardCatalogItem.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ pointsCost: "asc" }, { name: "asc" }],
      take: 100,
    }),
  ])
  const balanceByItem = new Map(balances.map((row) => [row.itemId, decimal(row._sum.quantityDelta)]))

  return {
    version: 1 as const,
    generatedAt: now.toISOString(),
    promotions: promotions.map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      kind: promotion.kind,
      config: promotion.config,
      activeFrom: promotion.activeFrom.toISOString(),
      activeTo: promotion.activeTo?.toISOString() ?? null,
      productIds: promotion.products.map((product) => product.productId),
    })),
    promotionExecutions: executions.map(promotionExecutionResult),
    inventory: {
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        kind: item.kind,
        productId: item.productId,
        unit: item.unit,
        balance: balanceByItem.get(item.id) ?? 0,
      })),
      events: inventoryEvents.map(inventoryEventResult),
    },
    orders: orders.map((order) => ({
      id: order.id,
      storeId: order.storeId,
      storeName: order.store.name,
      visitId: order.visitId,
      status: order.status,
      currency: order.currency,
      subtotalAmount: decimal(order.subtotalAmount),
      discountAmount: decimal(order.discountAmount),
      taxAmount: decimal(order.taxAmount),
      totalAmount: decimal(order.totalAmount),
      appliedPromotions: order.appliedPromotions,
      invoiceNumber: order.invoiceNumber,
      submittedAt: order.submittedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      lines: order.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        productName: line.product.name,
        sku: line.product.sku,
        quantity: decimal(line.quantity),
        unitPrice: decimal(line.unitPrice),
        totalAmount: decimal(line.totalAmount),
        promotionId: line.promotionId,
      })),
    })),
    returns: salesReturns.map(salesReturnResult),
    rewards: {
      balance: rewardAccount?.pointsBalance ?? 0,
      catalog: rewards.map((reward) => ({
        id: reward.id,
        code: reward.code,
        name: reward.name,
        description: reward.description,
        pointsCost: reward.pointsCost,
        stockQuantity: reward.stockQuantity,
        imageUrl: reward.imageUrl,
      })),
      claims: rewardAccount?.claims.map(rewardClaimResult) ?? [],
      ledger: rewardAccount?.ledgerEntries.map((entry) => ({
        id: entry.id,
        pointsDelta: entry.pointsDelta,
        reason: entry.reason,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        createdAt: entry.createdAt.toISOString(),
      })) ?? [],
    },
  }
}
