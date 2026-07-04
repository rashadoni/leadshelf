export type PromotionKind = "BULK_DISCOUNT" | "PERCENT_DISCOUNT" | "BOGO" | "GIFT" | "BUNDLE"

export interface OrderPromotionLineInput {
  lineId: string
  productId: string
  quantity: number
  unitPriceCents: number
}

export interface PromotionRule {
  id: string
  name: string
  kind: PromotionKind
  productIds?: string[]
  isActive?: boolean
  activeFrom?: Date
  activeTo?: Date | null
  customerCategory?: string | null
  config:
    | BulkDiscountConfig
    | PercentDiscountConfig
    | BogoConfig
    | GiftConfig
    | BundleDiscountConfig
}

export interface BulkDiscountConfig {
  minQty: number
  discountPercent?: number
  discountCentsPerUnit?: number
}

export interface PercentDiscountConfig {
  discountPercent: number
}

export interface BogoConfig {
  buyQty: number
  getQty: number
  discountPercent?: number
  maxFreeQty?: number
}

export interface GiftConfig {
  minQty: number
  giftProductId: string
  giftQuantity: number
}

export interface BundleDiscountConfig {
  required: Array<{ productId: string; minQty: number }>
  discountPercent?: number
  discountCents?: number
}

export interface AppliedPromotion {
  promotionId: string
  name: string
  kind: PromotionKind
  discountCents: number
}

export interface GiftAward {
  promotionId: string
  name: string
  productId: string
  quantity: number
}

export interface OrderPromotionLineResult {
  lineId: string
  productId: string
  quantity: number
  unitPriceCents: number
  grossCents: number
  discountCents: number
  netCents: number
  appliedPromotions: AppliedPromotion[]
}

export interface PromotionEngineResult {
  subtotalCents: number
  totalDiscountCents: number
  totalCents: number
  lines: OrderPromotionLineResult[]
  gifts: GiftAward[]
  appliedPromotions: AppliedPromotion[]
}

export interface ApplyPromotionsInput {
  lines: OrderPromotionLineInput[]
  promotions: PromotionRule[]
  at?: Date
  customerCategory?: string | null
}

const promotionOrder: Record<PromotionKind, number> = {
  BULK_DISCOUNT: 0,
  BUNDLE: 1,
  PERCENT_DISCOUNT: 2,
  BOGO: 3,
  GIFT: 4,
}

function assertValidLine(line: OrderPromotionLineInput): void {
  if (line.quantity <= 0 || !Number.isFinite(line.quantity)) {
    throw new Error(`line ${line.lineId} quantity must be greater than zero`)
  }
  if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
    throw new Error(`line ${line.lineId} unitPriceCents must be a non-negative integer`)
  }
}

function roundCents(value: number): number {
  return Math.max(0, Math.round(value))
}

function percentDiscount(amountCents: number, percent: number): number {
  if (percent <= 0) return 0
  return roundCents((amountCents * Math.min(percent, 100)) / 100)
}

function lineGrossCents(line: OrderPromotionLineInput): number {
  return roundCents(line.quantity * line.unitPriceCents)
}

function appliesToProduct(promotion: PromotionRule, productId: string): boolean {
  return !promotion.productIds?.length || promotion.productIds.includes(productId)
}

function isPromotionActive(promotion: PromotionRule, at: Date, customerCategory?: string | null): boolean {
  if (promotion.isActive === false) return false
  if (promotion.activeFrom && promotion.activeFrom > at) return false
  if (promotion.activeTo && promotion.activeTo < at) return false
  if (promotion.customerCategory && promotion.customerCategory !== customerCategory) return false
  return true
}

function addLineDiscount(
  line: OrderPromotionLineResult,
  promotion: PromotionRule,
  discountCents: number,
): AppliedPromotion | null {
  const cappedDiscount = Math.min(discountCents, line.netCents)
  if (cappedDiscount <= 0) return null
  const applied = {
    promotionId: promotion.id,
    name: promotion.name,
    kind: promotion.kind,
    discountCents: cappedDiscount,
  }
  line.discountCents += cappedDiscount
  line.netCents -= cappedDiscount
  line.appliedPromotions.push(applied)
  return applied
}

function applyBulkDiscount(lines: OrderPromotionLineResult[], promotion: PromotionRule): AppliedPromotion[] {
  const config = promotion.config as BulkDiscountConfig
  const applied: AppliedPromotion[] = []
  for (const line of lines) {
    if (!appliesToProduct(promotion, line.productId) || line.quantity < config.minQty) continue
    const discount =
      config.discountCentsPerUnit != null
        ? roundCents(config.discountCentsPerUnit * line.quantity)
        : percentDiscount(line.netCents, config.discountPercent ?? 0)
    const lineApplied = addLineDiscount(line, promotion, discount)
    if (lineApplied) applied.push(lineApplied)
  }
  return applied
}

function applyPercentDiscount(lines: OrderPromotionLineResult[], promotion: PromotionRule): AppliedPromotion[] {
  const config = promotion.config as PercentDiscountConfig
  const applied: AppliedPromotion[] = []
  for (const line of lines) {
    if (!appliesToProduct(promotion, line.productId)) continue
    const lineApplied = addLineDiscount(line, promotion, percentDiscount(line.netCents, config.discountPercent))
    if (lineApplied) applied.push(lineApplied)
  }
  return applied
}

function applyBogo(lines: OrderPromotionLineResult[], promotion: PromotionRule): AppliedPromotion[] {
  const config = promotion.config as BogoConfig
  const applied: AppliedPromotion[] = []
  const cycleQty = config.buyQty + config.getQty
  if (cycleQty <= 0 || config.getQty <= 0) return applied

  for (const line of lines) {
    if (!appliesToProduct(promotion, line.productId)) continue
    const cycleCount = Math.floor(line.quantity / cycleQty)
    const freeQty = Math.min(cycleCount * config.getQty, config.maxFreeQty ?? Number.POSITIVE_INFINITY)
    const discount = percentDiscount(roundCents(freeQty * line.unitPriceCents), config.discountPercent ?? 100)
    const lineApplied = addLineDiscount(line, promotion, discount)
    if (lineApplied) applied.push(lineApplied)
  }
  return applied
}

function allocateDiscountByGross(
  lines: OrderPromotionLineResult[],
  promotion: PromotionRule,
  discountCents: number,
): AppliedPromotion[] {
  const eligibleLines = lines.filter((line) => appliesToProduct(promotion, line.productId) && line.netCents > 0)
  const eligibleGross = eligibleLines.reduce((sum, line) => sum + line.netCents, 0)
  const applied: AppliedPromotion[] = []
  let remaining = Math.min(discountCents, eligibleGross)

  eligibleLines.forEach((line, index) => {
    const isLast = index === eligibleLines.length - 1
    const share = isLast ? remaining : roundCents((discountCents * line.netCents) / eligibleGross)
    const lineApplied = addLineDiscount(line, promotion, Math.min(share, remaining))
    if (lineApplied) {
      remaining -= lineApplied.discountCents
      applied.push(lineApplied)
    }
  })

  return applied
}

function applyBundle(lines: OrderPromotionLineResult[], promotion: PromotionRule): AppliedPromotion[] {
  const config = promotion.config as BundleDiscountConfig
  const hasRequiredProducts = config.required.every((required) => {
    const line = lines.find((candidate) => candidate.productId === required.productId)
    return line != null && line.quantity >= required.minQty
  })
  if (!hasRequiredProducts) return []

  const bundleLines = lines.filter((line) => config.required.some((required) => required.productId === line.productId))
  const bundleNet = bundleLines.reduce((sum, line) => sum + line.netCents, 0)
  const discount = config.discountCents ?? percentDiscount(bundleNet, config.discountPercent ?? 0)
  return allocateDiscountByGross(bundleLines, promotion, discount)
}

function applyGift(lines: OrderPromotionLineResult[], promotion: PromotionRule): GiftAward[] {
  const config = promotion.config as GiftConfig
  const eligibleQty = lines
    .filter((line) => appliesToProduct(promotion, line.productId))
    .reduce((sum, line) => sum + line.quantity, 0)
  if (eligibleQty < config.minQty || config.giftQuantity <= 0) return []
  return [
    {
      promotionId: promotion.id,
      name: promotion.name,
      productId: config.giftProductId,
      quantity: config.giftQuantity,
    },
  ]
}

export function applyPromotions(input: ApplyPromotionsInput): PromotionEngineResult {
  const at = input.at ?? new Date()
  const lines = input.lines.map((line) => {
    assertValidLine(line)
    const grossCents = lineGrossCents(line)
    return {
      ...line,
      grossCents,
      discountCents: 0,
      netCents: grossCents,
      appliedPromotions: [],
    }
  })

  const activePromotions = input.promotions
    .filter((promotion) => isPromotionActive(promotion, at, input.customerCategory))
    .slice()
    .sort((a, b) => promotionOrder[a.kind] - promotionOrder[b.kind])

  const appliedPromotions: AppliedPromotion[] = []
  const gifts: GiftAward[] = []

  for (const promotion of activePromotions) {
    if (promotion.kind === "BULK_DISCOUNT") appliedPromotions.push(...applyBulkDiscount(lines, promotion))
    if (promotion.kind === "BUNDLE") appliedPromotions.push(...applyBundle(lines, promotion))
    if (promotion.kind === "PERCENT_DISCOUNT") appliedPromotions.push(...applyPercentDiscount(lines, promotion))
    if (promotion.kind === "BOGO") appliedPromotions.push(...applyBogo(lines, promotion))
    if (promotion.kind === "GIFT") gifts.push(...applyGift(lines, promotion))
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.grossCents, 0)
  const totalDiscountCents = lines.reduce((sum, line) => sum + line.discountCents, 0)

  return {
    subtotalCents,
    totalDiscountCents,
    totalCents: subtotalCents - totalDiscountCents,
    lines,
    gifts,
    appliedPromotions,
  }
}
