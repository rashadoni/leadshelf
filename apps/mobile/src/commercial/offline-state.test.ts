import { describe, expect, test } from "vitest"
import type { MobileCommercialSnapshot } from "@leadshelf/api-contracts/mobile/v1"
import {
  projectCommercialSnapshot,
  type CommercialProjectionOperation,
} from "./offline-state"

function snapshot(): MobileCommercialSnapshot {
  return {
    version: 1,
    generatedAt: "2026-07-16T08:00:00.000Z",
    promotions: [{
      id: "promo-1",
      name: "Promo",
      kind: "discount",
      config: {},
      activeFrom: "2026-07-01T00:00:00.000Z",
      activeTo: null,
      productIds: ["product-1"],
    }],
    promotionExecutions: [],
    inventory: {
      items: [{
        id: "item-1",
        code: "S-1",
        name: "Sample",
        kind: "SAMPLE",
        productId: "product-1",
        unit: "PCS",
        balance: 5,
      }],
      events: [],
    },
    orders: [{
      id: "order-1",
      storeId: "store-1",
      storeName: "Clinic",
      visitId: "visit-1",
      status: "DELIVERED",
      currency: "AZN",
      subtotalAmount: 20,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 20,
      appliedPromotions: [],
      invoiceNumber: "INV-1",
      submittedAt: "2026-07-15T09:00:00.000Z",
      createdAt: "2026-07-15T09:00:00.000Z",
      updatedAt: "2026-07-15T09:00:00.000Z",
      lines: [{
        id: "line-1",
        productId: "product-1",
        productName: "Product",
        sku: "SKU-1",
        quantity: 2,
        unitPrice: 10,
        totalAmount: 20,
        promotionId: null,
      }],
    }],
    returns: [],
    rewards: {
      balance: 100,
      catalog: [{
        id: "reward-1",
        code: "R-1",
        name: "Mug",
        description: null,
        pointsCost: 30,
        stockQuantity: 2,
        imageUrl: null,
      }],
      claims: [],
      ledger: [],
    },
  }
}

describe("commercial offline projection", () => {
  test("projects queued promotion, inventory, return, and reward actions", () => {
    const operations: CommercialProjectionOperation[] = [
      {
        clientOpId: "op-promo-enroll",
        kind: "promotion.enroll",
        payload: {
          promotionId: "promo-1",
          storeId: "store-1",
          visitId: "visit-1",
          clientExecutionId: "execution-1",
        },
        clientCreatedAt: "2026-07-16T08:10:00.000Z",
        status: "pending",
      },
      {
        clientOpId: "op-promo-submit",
        kind: "promotion.submit",
        payload: { clientExecutionId: "execution-1", note: "Done" },
        clientCreatedAt: "2026-07-16T08:11:00.000Z",
        status: "pending",
      },
      {
        clientOpId: "op-stock",
        kind: "inventory.record",
        payload: {
          itemId: "item-1",
          eventType: "ISSUE",
          quantity: 2,
          storeId: "store-1",
          visitId: "visit-1",
          recordedAt: "2026-07-16T08:12:00.000Z",
        },
        clientCreatedAt: "2026-07-16T08:12:00.000Z",
        status: "pending",
      },
      {
        clientOpId: "op-return",
        kind: "return.create",
        payload: {
          orderId: "order-1",
          visitId: "visit-1",
          reason: "DAMAGED",
          lines: [{ orderLineId: "line-1", quantity: 1 }],
        },
        clientCreatedAt: "2026-07-16T08:13:00.000Z",
        status: "pending",
      },
      {
        clientOpId: "op-reward",
        kind: "reward.claim",
        payload: { rewardItemId: "reward-1", quantity: 1 },
        clientCreatedAt: "2026-07-16T08:14:00.000Z",
        status: "pending",
      },
    ]
    const projected = projectCommercialSnapshot(snapshot(), operations)
    expect(projected.pendingCount).toBe(5)
    expect(projected.snapshot.promotionExecutions).toEqual([
      expect.objectContaining({ clientExecutionId: "execution-1", status: "SUBMITTED" }),
    ])
    expect(projected.snapshot.inventory.items[0]?.balance).toBe(3)
    expect(projected.snapshot.returns[0]).toMatchObject({ orderId: "order-1", status: "SUBMITTED" })
    expect(projected.snapshot.rewards.balance).toBe(70)
    expect(projected.snapshot.rewards.claims[0]).toMatchObject({ rewardItemId: "reward-1", pointsCost: 30 })
  })

  test("does not double-project an applied operation covered by a newer snapshot", () => {
    const projected = projectCommercialSnapshot(snapshot(), [{
      clientOpId: "op-old-stock",
      kind: "inventory.record",
      payload: {
        itemId: "item-1",
        eventType: "RECEIVE",
        quantity: 4,
        recordedAt: "2026-07-16T07:00:00.000Z",
      },
      clientCreatedAt: "2026-07-16T07:00:00.000Z",
      status: "applied",
    }])
    expect(projected.snapshot.inventory.items[0]?.balance).toBe(5)
  })

  test("leaves conflicted mutations out of optimistic balances", () => {
    const projected = projectCommercialSnapshot(snapshot(), [{
      clientOpId: "op-conflict-stock",
      kind: "inventory.record",
      payload: {
        itemId: "item-1",
        eventType: "ISSUE",
        quantity: 99,
        storeId: "store-1",
        recordedAt: "2026-07-16T09:00:00.000Z",
      },
      clientCreatedAt: "2026-07-16T09:00:00.000Z",
      status: "conflict",
    }])
    expect(projected.attentionCount).toBe(1)
    expect(projected.snapshot.inventory.items[0]?.balance).toBe(5)
  })
})
