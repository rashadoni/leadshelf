import { describe, expect, it } from "vitest"
import { applyPromotions, type PromotionRule } from "./promotion-engine.ts"

const at = new Date("2026-07-04T10:00:00.000Z")

describe("promotion engine", () => {
  it("applies MTM promotion order: bulk, percent, bogo, gift", () => {
    const promotions: PromotionRule[] = [
      {
        id: "gift-1",
        name: "free tester",
        kind: "GIFT",
        productIds: ["sku-a"],
        config: { minQty: 5, giftProductId: "gift-sku", giftQuantity: 1 },
      },
      {
        id: "percent-1",
        name: "pharmacy loyalty",
        kind: "PERCENT_DISCOUNT",
        productIds: ["sku-a"],
        config: { discountPercent: 10 },
      },
      {
        id: "bulk-1",
        name: "case discount",
        kind: "BULK_DISCOUNT",
        productIds: ["sku-a"],
        config: { minQty: 5, discountPercent: 20 },
      },
      {
        id: "bogo-1",
        name: "buy two get one",
        kind: "BOGO",
        productIds: ["sku-a"],
        config: { buyQty: 2, getQty: 1 },
      },
    ]

    const result = applyPromotions({
      at,
      lines: [{ lineId: "line-1", productId: "sku-a", quantity: 6, unitPriceCents: 1_000 }],
      promotions,
    })

    expect(result.subtotalCents).toBe(6_000)
    expect(result.appliedPromotions.map((promotion) => promotion.promotionId)).toEqual([
      "bulk-1",
      "percent-1",
      "bogo-1",
    ])
    expect(result.lines[0]).toMatchObject({
      grossCents: 6_000,
      discountCents: 3_680,
      netCents: 2_320,
    })
    expect(result.gifts).toEqual([
      { promotionId: "gift-1", name: "free tester", productId: "gift-sku", quantity: 1 },
    ])
  })

  it("applies bundle discounts only when all required products are present", () => {
    const bundle: PromotionRule = {
      id: "bundle-1",
      name: "shelf starter bundle",
      kind: "BUNDLE",
      config: {
        required: [
          { productId: "sku-a", minQty: 2 },
          { productId: "sku-b", minQty: 1 },
        ],
        discountCents: 500,
      },
    }

    const missing = applyPromotions({
      at,
      lines: [{ lineId: "line-a", productId: "sku-a", quantity: 2, unitPriceCents: 1_000 }],
      promotions: [bundle],
    })
    expect(missing.totalDiscountCents).toBe(0)

    const applied = applyPromotions({
      at,
      lines: [
        { lineId: "line-a", productId: "sku-a", quantity: 2, unitPriceCents: 1_000 },
        { lineId: "line-b", productId: "sku-b", quantity: 1, unitPriceCents: 3_000 },
      ],
      promotions: [bundle],
    })
    expect(applied.totalDiscountCents).toBe(500)
    expect(applied.lines.map((line) => line.discountCents)).toEqual([200, 300])
  })

  it("filters inactive, expired, future, and customer-category promotions", () => {
    const promotions: PromotionRule[] = [
      {
        id: "active",
        name: "active",
        kind: "PERCENT_DISCOUNT",
        customerCategory: "A",
        config: { discountPercent: 10 },
      },
      {
        id: "expired",
        name: "expired",
        kind: "PERCENT_DISCOUNT",
        activeTo: new Date("2026-01-01T00:00:00.000Z"),
        config: { discountPercent: 90 },
      },
      {
        id: "future",
        name: "future",
        kind: "PERCENT_DISCOUNT",
        activeFrom: new Date("2027-01-01T00:00:00.000Z"),
        config: { discountPercent: 90 },
      },
      {
        id: "inactive",
        name: "inactive",
        kind: "PERCENT_DISCOUNT",
        isActive: false,
        config: { discountPercent: 90 },
      },
    ]

    const result = applyPromotions({
      at,
      customerCategory: "A",
      lines: [{ lineId: "line-1", productId: "sku-a", quantity: 1, unitPriceCents: 1_000 }],
      promotions,
    })

    expect(result.totalDiscountCents).toBe(100)
    expect(result.appliedPromotions.map((promotion) => promotion.promotionId)).toEqual(["active"])
  })
})
