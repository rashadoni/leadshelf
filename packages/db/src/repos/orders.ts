import type { PrismaClient } from "@prisma/client"
import { Prisma } from "@prisma/client"
import {
  applyPromotions,
  buildInvoiceNumber,
  checkCreditLimit,
  generateInvoice,
  renderInvoiceHtml,
  type PromotionKind,
  type PromotionRule,
} from "@leadshelf/core"

export class OrderRepoError extends Error {
  constructor(
    public code:
      | "store_not_found"
      | "visit_not_found"
      | "agent_not_found"
      | "visit_store_mismatch"
      | "product_not_found"
      | "product_price_missing"
      | "credit_limit_exceeded"
      | "credit_account_blocked"
      | "invalid_promotion_config",
    message = code,
    public detail?: unknown,
  ) {
    super(message)
  }
}

export interface CreateOrderLineInput {
  productId: string
  quantity: number
}

export interface CreateOrderInput {
  storeId: string
  visitId?: string | null
  lines: CreateOrderLineInput[]
  userId?: string | null
  deviceId?: string | null
  clientOpId?: string | null
}

export interface OrderSummary {
  id: string
  status: string
  storeId: string
  visitId: string | null
  currency: string
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
  invoiceNumber: string | null
  createdAt: string
}

function decimalToCents(value: Prisma.Decimal | number | string): number {
  return Math.round(Number(value) * 100)
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberConfig(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizePromotionKind(raw: string, config: Record<string, unknown>): PromotionKind | null {
  const kind = raw.toUpperCase()
  if (kind === "BULK_DISCOUNT" || kind === "PERCENT_DISCOUNT" || kind === "BOGO" || kind === "GIFT" || kind === "BUNDLE") {
    return kind
  }
  if (kind === "DISCOUNT") return numberConfig(config, "minQty") ? "BULK_DISCOUNT" : "PERCENT_DISCOUNT"
  if (kind === "BONUS") return "GIFT"
  if (kind === "BUNDLE_DISCOUNT") return "BUNDLE"
  return null
}

function promotionRuleFromRow(row: {
  id: string
  name: string
  kind: string
  config: unknown
  activeFrom: Date
  activeTo: Date | null
  isActive: boolean
  products: Array<{ productId: string }>
}): PromotionRule | null {
  const config = asRecord(row.config)
  const kind = normalizePromotionKind(row.kind, config)
  if (!kind) return null

  if (kind === "BULK_DISCOUNT") {
    return {
      id: row.id,
      name: row.name,
      kind,
      productIds: row.products.map((p) => p.productId),
      isActive: row.isActive,
      activeFrom: row.activeFrom,
      activeTo: row.activeTo,
      config: {
        minQty: numberConfig(config, "minQty") ?? 1,
        discountPercent: numberConfig(config, "discountPercent"),
        discountCentsPerUnit: numberConfig(config, "discountCentsPerUnit"),
      },
    }
  }
  if (kind === "PERCENT_DISCOUNT") {
    return {
      id: row.id,
      name: row.name,
      kind,
      productIds: row.products.map((p) => p.productId),
      isActive: row.isActive,
      activeFrom: row.activeFrom,
      activeTo: row.activeTo,
      config: { discountPercent: numberConfig(config, "discountPercent") ?? 0 },
    }
  }
  if (kind === "BOGO") {
    return {
      id: row.id,
      name: row.name,
      kind,
      productIds: row.products.map((p) => p.productId),
      isActive: row.isActive,
      activeFrom: row.activeFrom,
      activeTo: row.activeTo,
      config: {
        buyQty: numberConfig(config, "buyQty") ?? 1,
        getQty: numberConfig(config, "getQty") ?? 1,
        discountPercent: numberConfig(config, "discountPercent"),
        maxFreeQty: numberConfig(config, "maxFreeQty"),
      },
    }
  }
  if (kind === "GIFT") {
    const giftProductId = typeof config.giftProductId === "string" ? config.giftProductId : null
    if (!giftProductId) return null
    return {
      id: row.id,
      name: row.name,
      kind,
      productIds: row.products.map((p) => p.productId),
      isActive: row.isActive,
      activeFrom: row.activeFrom,
      activeTo: row.activeTo,
      config: {
        minQty: numberConfig(config, "minQty") ?? 1,
        giftProductId,
        giftQuantity: numberConfig(config, "giftQuantity") ?? 1,
      },
    }
  }

  const required = Array.isArray(config.required)
    ? config.required.flatMap((item) => {
        const r = asRecord(item)
        return typeof r.productId === "string"
          ? [{ productId: r.productId, minQty: numberConfig(r, "minQty") ?? 1 }]
          : []
      })
    : []
  if (required.length === 0) return null
  return {
    id: row.id,
    name: row.name,
    kind,
    productIds: row.products.map((p) => p.productId),
    isActive: row.isActive,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    config: {
      required,
      discountPercent: numberConfig(config, "discountPercent"),
      discountCents: numberConfig(config, "discountCents"),
    },
  }
}

async function latestPriceCents(
  prisma: PrismaClient,
  organizationId: string,
  storeId: string,
  productId: string,
): Promise<number | null> {
  const [storePrice, globalPrice] = await Promise.all([
    prisma.priceSnapshot.findFirst({
      where: { organizationId, productId, storeId },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { price: true },
    }),
    prisma.priceSnapshot.findFirst({
      where: { organizationId, productId, storeId: null },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { price: true },
    }),
  ])
  const price = storePrice?.price ?? globalPrice?.price ?? null
  return price ? decimalToCents(price) : null
}

function summarizeOrder(order: {
  id: string
  status: string
  storeId: string
  visitId: string | null
  currency: string
  subtotalAmount: Prisma.Decimal
  discountAmount: Prisma.Decimal
  taxAmount: Prisma.Decimal
  totalAmount: Prisma.Decimal
  invoiceNumber: string | null
  createdAt: Date
}): OrderSummary {
  return {
    id: order.id,
    status: order.status,
    storeId: order.storeId,
    visitId: order.visitId,
    currency: order.currency,
    subtotalCents: decimalToCents(order.subtotalAmount),
    discountCents: decimalToCents(order.discountAmount),
    taxCents: decimalToCents(order.taxAmount),
    totalCents: decimalToCents(order.totalAmount),
    invoiceNumber: order.invoiceNumber,
    createdAt: order.createdAt.toISOString(),
  }
}

type CreditLimitRow = {
  id: string
  limitAmount: Prisma.Decimal
  usedAmount: Prisma.Decimal
  currency: string
}

function creditLimitError(result: ReturnType<typeof checkCreditLimit>): OrderRepoError | null {
  if (result.status === "EXCEEDED") {
    return new OrderRepoError("credit_limit_exceeded", "credit_limit_exceeded", result)
  }
  if (result.status === "BLOCKED") {
    return new OrderRepoError("credit_account_blocked", "credit_account_blocked", result)
  }
  return null
}

async function reserveCreditLimit(
  tx: Prisma.TransactionClient,
  credit: CreditLimitRow,
  orderTotalCents: number,
): Promise<void> {
  let currentCredit = credit

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const creditResult = checkCreditLimit({
      limitCents: decimalToCents(currentCredit.limitAmount),
      usedCents: decimalToCents(currentCredit.usedAmount),
      orderTotalCents,
      currency: currentCredit.currency,
    })
    const error = creditLimitError(creditResult)
    if (error) throw error

    const updated = await tx.creditLimit.updateMany({
      where: {
        id: currentCredit.id,
        usedAmount: { lte: centsToDecimal(creditResult.limitCents - creditResult.orderTotalCents) },
      },
      data: { usedAmount: { increment: centsToDecimal(orderTotalCents) } },
    })
    if (updated.count === 1) return

    const latestCredit = await tx.creditLimit.findUnique({
      where: { id: currentCredit.id },
      select: { id: true, limitAmount: true, usedAmount: true, currency: true },
    })
    if (!latestCredit) return
    currentCredit = latestCredit
  }

  const creditResult = checkCreditLimit({
    limitCents: decimalToCents(currentCredit.limitAmount),
    usedCents: decimalToCents(currentCredit.usedAmount),
    orderTotalCents,
    currency: currentCredit.currency,
  })
  throw creditLimitError(creditResult) ?? new OrderRepoError("credit_limit_exceeded", "credit_limit_exceeded", creditResult)
}

export async function createOrder(
  prisma: PrismaClient,
  organizationId: string,
  input: CreateOrderInput,
): Promise<OrderSummary> {
  const now = new Date()
  const [org, store, visit, agent] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true } }),
    prisma.store.findFirst({
      where: { id: input.storeId, organizationId, isActive: true },
      select: { id: true, name: true, code: true },
    }),
    input.visitId
      ? prisma.visit.findFirst({
          where: { id: input.visitId, organizationId },
          select: { id: true, storeId: true, agentId: true },
        })
      : Promise.resolve(null),
    input.userId
      ? prisma.fieldAgent.findFirst({
          where: { organizationId, userId: input.userId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (!store) throw new OrderRepoError("store_not_found")
  if (input.visitId && !visit) throw new OrderRepoError("visit_not_found")
  if (visit && visit.storeId !== store.id) throw new OrderRepoError("visit_store_mismatch")
  if (visit && agent && visit.agentId !== agent.id) throw new OrderRepoError("visit_not_found")

  const productIds = [...new Set(input.lines.map((line) => line.productId))]
  const products = await prisma.product.findMany({
    where: { organizationId, id: { in: productIds }, isActive: true },
    select: { id: true, sku: true, name: true },
  })
  const productById = new Map(products.map((product) => [product.id, product]))
  for (const productId of productIds) {
    if (!productById.has(productId)) throw new OrderRepoError("product_not_found", "product_not_found", { productId })
  }

  const priceEntries = await Promise.all(
    productIds.map(async (productId) => [productId, await latestPriceCents(prisma, organizationId, store.id, productId)] as const),
  )
  const priceByProductId = new Map(priceEntries)
  for (const [productId, price] of priceByProductId) {
    if (price === null) throw new OrderRepoError("product_price_missing", "product_price_missing", { productId })
  }

  const promotionRows = await prisma.promotion.findMany({
    where: {
      organizationId,
      isActive: true,
      activeFrom: { lte: now },
      OR: [{ activeTo: null }, { activeTo: { gte: now } }],
    },
    include: { products: { select: { productId: true } } },
  })
  const promotions = promotionRows.flatMap((row) => {
    const rule = promotionRuleFromRow(row)
    return rule ? [rule] : []
  })

  const pricing = applyPromotions({
    at: now,
    lines: input.lines.map((line, index) => ({
      lineId: `line-${index}`,
      productId: line.productId,
      quantity: line.quantity,
      unitPriceCents: priceByProductId.get(line.productId) ?? 0,
    })),
    promotions,
  })

  const existing = input.deviceId && input.clientOpId
    ? await prisma.order.findFirst({
        where: { organizationId, clientDeviceId: input.deviceId, clientOpId: input.clientOpId },
      })
    : null
  if (existing) return summarizeOrder(existing)

  return prisma.$transaction(async (tx) => {
    if (input.deviceId && input.clientOpId) {
      const existingInTx = await tx.order.findFirst({
        where: { organizationId, clientDeviceId: input.deviceId, clientOpId: input.clientOpId },
      })
      if (existingInTx) return summarizeOrder(existingInTx)
    }

    const credit = await tx.creditLimit.findFirst({
      where: { storeId: store.id },
      select: { id: true, limitAmount: true, usedAmount: true, currency: true },
    })
    if (credit) {
      await reserveCreditLimit(tx, credit, pricing.totalCents)
    }

    const sequence = await tx.order.count({ where: { organizationId } })
    const invoiceNumber = buildInvoiceNumber({ issuedAt: now, sequence: sequence + 1 })
    const invoiceDraft = generateInvoice({
      invoiceNumber,
      orderId: "pending",
      issuedAt: now,
      seller: { name: org?.name ?? "LeadShelf" },
      buyer: { name: store.name, taxId: store.code },
      lines: pricing.lines.map((line) => {
        const product = productById.get(line.productId)!
        return {
          lineId: line.lineId,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountCents,
        }
      }),
    })

    const order = await tx.order.create({
      data: {
        organizationId,
        storeId: store.id,
        agentId: agent?.id,
        visitId: visit?.id,
        status: "SUBMITTED",
        currency: invoiceDraft.currency,
        subtotalAmount: centsToDecimal(invoiceDraft.subtotalCents),
        discountAmount: centsToDecimal(invoiceDraft.discountCents),
        taxAmount: centsToDecimal(invoiceDraft.taxCents),
        totalAmount: centsToDecimal(invoiceDraft.totalCents),
        appliedPromotions: pricing.appliedPromotions as object,
        invoiceNumber,
        clientDeviceId: input.deviceId ?? null,
        clientOpId: input.clientOpId ?? null,
        submittedAt: now,
      },
    })
    const finalInvoice = { ...invoiceDraft, orderId: order.id }
    await tx.order.update({
      where: { id: order.id },
      data: { invoiceHtml: renderInvoiceHtml(finalInvoice) },
    })

    for (const line of pricing.lines) {
      const firstPromotion = line.appliedPromotions[0]
      await tx.orderLine.create({
        data: {
          orderId: order.id,
          productId: line.productId,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: centsToDecimal(line.unitPriceCents),
          discountPct: line.grossCents > 0 ? (line.discountCents / line.grossCents) * 100 : 0,
          grossAmount: centsToDecimal(line.grossCents),
          discountAmount: centsToDecimal(line.discountCents),
          taxAmount: centsToDecimal(0),
          totalAmount: centsToDecimal(line.netCents),
          promotionId: firstPromotion?.promotionId,
        },
      })
    }

    return summarizeOrder(order)
  })
}
