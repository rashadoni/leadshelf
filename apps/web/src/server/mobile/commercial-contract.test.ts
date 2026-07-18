import { describe, expect, test } from "vitest"
import {
  EMPTY_MOBILE_COMMERCIAL_SNAPSHOT,
  MOBILE_PROTOCOL_VERSION,
  mobileSyncPullResponseSchema,
  mobileSyncPushRequestSchema,
} from "@leadshelf/api-contracts/mobile/v1"

describe("mobile commercial contract", () => {
  test("keeps legacy pull responses additive with an empty commercial default", () => {
    const parsed = mobileSyncPullResponseSchema.parse({
      tasks: [],
      stores: [],
      planogramBundles: [],
      cursors: { tasks: null, planogramBundles: null },
    })
    expect(parsed.commercial).toEqual(EMPTY_MOBILE_COMMERCIAL_SNAPSHOT)
  })

  test("accepts every agent commercial outbox operation", () => {
    const operations = [
      {
        clientOpId: "op-promotion-enroll-0001",
        kind: "promotion.enroll",
        payload: {
          promotionId: "promotion-1",
          storeId: "store-1",
          visitId: "visit-1",
          clientExecutionId: "execution-0001",
        },
      },
      {
        clientOpId: "op-promotion-submit-0001",
        kind: "promotion.submit",
        payload: { clientExecutionId: "execution-0001", note: "Display installed" },
      },
      {
        clientOpId: "op-inventory-record-0001",
        kind: "inventory.record",
        payload: {
          itemId: "item-1",
          eventType: "ISSUE",
          quantity: 2,
          storeId: "store-1",
          visitId: "visit-1",
          recordedAt: "2026-07-16T09:00:00.000Z",
        },
      },
      {
        clientOpId: "op-return-create-0001",
        kind: "return.create",
        payload: {
          orderId: "order-1",
          reason: "DAMAGED",
          lines: [{ orderLineId: "line-1", quantity: 1 }],
        },
      },
      {
        clientOpId: "op-reward-claim-0001",
        kind: "reward.claim",
        payload: { rewardItemId: "reward-1", quantity: 1 },
      },
    ]
    const parsed = mobileSyncPushRequestSchema.parse({
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      operations,
    })
    expect(parsed.operations.map((operation) => operation.kind)).toEqual(
      operations.map((operation) => operation.kind),
    )
  })

  test("rejects promotion submission without proof and invalid reward quantity", () => {
    const proofless = mobileSyncPushRequestSchema.safeParse({
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      operations: [{
        clientOpId: "op-promotion-submit-0002",
        kind: "promotion.submit",
        payload: { clientExecutionId: "execution-0002" },
      }],
    })
    const invalidReward = mobileSyncPushRequestSchema.safeParse({
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      operations: [{
        clientOpId: "op-reward-claim-0002",
        kind: "reward.claim",
        payload: { rewardItemId: "reward-1", quantity: 0 },
      }],
    })
    expect(proofless.success).toBe(false)
    expect(invalidReward.success).toBe(false)
  })
})
