import type {
  MobileCommercialSnapshot,
  MobilePushOperation,
} from "@leadshelf/api-contracts/mobile/v1"

export type CommercialMobileOperation = Extract<
  MobilePushOperation,
  { kind: "promotion.enroll" | "promotion.submit" | "inventory.record" | "return.create" | "reward.claim" }
>

export type CommercialProjectionOperation = CommercialMobileOperation & {
  clientCreatedAt: string
  status: "pending" | "applied" | "conflict" | "rejected"
}

export interface CommercialProjection {
  snapshot: MobileCommercialSnapshot
  pendingCount: number
  attentionCount: number
}

function shouldProject(snapshotAt: number, operation: CommercialProjectionOperation): boolean {
  if (operation.status === "conflict" || operation.status === "rejected") return false
  if (operation.status === "pending") return true
  const operationAt = Date.parse(operation.clientCreatedAt)
  return !Number.isFinite(snapshotAt) || !Number.isFinite(operationAt) || operationAt > snapshotAt
}

export function projectCommercialSnapshot(
  source: MobileCommercialSnapshot,
  operations: CommercialProjectionOperation[],
): CommercialProjection {
  const snapshot: MobileCommercialSnapshot = {
    ...source,
    promotions: [...source.promotions],
    promotionExecutions: source.promotionExecutions.map((item) => ({ ...item })),
    inventory: {
      items: source.inventory.items.map((item) => ({ ...item })),
      events: source.inventory.events.map((item) => ({ ...item })),
    },
    orders: source.orders.map((order) => ({ ...order, lines: order.lines.map((line) => ({ ...line })) })),
    returns: source.returns.map((item) => ({ ...item, lines: item.lines.map((line) => ({ ...line })) })),
    rewards: {
      balance: source.rewards.balance,
      catalog: source.rewards.catalog.map((item) => ({ ...item })),
      claims: source.rewards.claims.map((item) => ({ ...item })),
      ledger: source.rewards.ledger.map((item) => ({ ...item })),
    },
  }
  const snapshotAt = Date.parse(source.generatedAt)
  const sorted = [...operations].sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt))

  for (const operation of sorted) {
    if (!shouldProject(snapshotAt, operation)) continue
    if (operation.kind === "promotion.enroll") {
      if (snapshot.promotionExecutions.some((item) => item.clientExecutionId === operation.payload.clientExecutionId)) continue
      snapshot.promotionExecutions.unshift({
        id: `local:${operation.clientOpId}`,
        clientExecutionId: operation.payload.clientExecutionId,
        promotionId: operation.payload.promotionId,
        storeId: operation.payload.storeId,
        visitId: operation.payload.visitId ?? null,
        status: "ENROLLED",
        note: operation.payload.note ?? null,
        proofPhotoUrl: null,
        submittedAt: null,
        updatedAt: operation.clientCreatedAt,
      })
      continue
    }
    if (operation.kind === "promotion.submit") {
      const execution = snapshot.promotionExecutions.find(
        (item) => item.clientExecutionId === operation.payload.clientExecutionId,
      )
      if (execution) {
        execution.status = "SUBMITTED"
        execution.note = operation.payload.note ?? execution.note
        execution.proofPhotoUrl = operation.payload.proofPhotoUrl ?? execution.proofPhotoUrl
        execution.submittedAt = operation.clientCreatedAt
        execution.updatedAt = operation.clientCreatedAt
      }
      continue
    }
    if (operation.kind === "inventory.record") {
      const item = snapshot.inventory.items.find((candidate) => candidate.id === operation.payload.itemId)
      if (!item) continue
      let delta = 0
      if (operation.payload.eventType === "COUNT_ADJUSTMENT") {
        const counted = operation.payload.countedBalance
        if (counted == null) continue
        delta = counted - item.balance
        item.balance = counted
      } else {
        const quantity = operation.payload.quantity ?? 0
        delta = operation.payload.eventType === "RECEIVE" ? quantity : -quantity
        item.balance += delta
      }
      snapshot.inventory.events.unshift({
        id: `local:${operation.clientOpId}`,
        itemId: operation.payload.itemId,
        eventType: operation.payload.eventType,
        quantityDelta: delta,
        countedBalance: operation.payload.countedBalance ?? null,
        storeId: operation.payload.storeId ?? null,
        visitId: operation.payload.visitId ?? null,
        reason: operation.payload.reason ?? null,
        note: operation.payload.note ?? null,
        recordedAt: operation.payload.recordedAt,
      })
      continue
    }
    if (operation.kind === "return.create") {
      if (snapshot.returns.some((item) => item.id === `local:${operation.clientOpId}`)) continue
      const order = snapshot.orders.find((candidate) => candidate.id === operation.payload.orderId)
      if (!order) continue
      const lines = operation.payload.lines.flatMap((requested, index) => {
        const sourceLine = order.lines.find((line) => line.id === requested.orderLineId)
        return sourceLine ? [{
          id: `local:${operation.clientOpId}:${index}`,
          orderLineId: sourceLine.id,
          productId: sourceLine.productId,
          quantity: requested.quantity,
          unitAmount: sourceLine.unitPrice,
        }] : []
      })
      snapshot.returns.unshift({
        id: `local:${operation.clientOpId}`,
        orderId: order.id,
        storeId: order.storeId,
        visitId: operation.payload.visitId ?? order.visitId,
        status: "SUBMITTED",
        reason: operation.payload.reason,
        note: operation.payload.note ?? null,
        evidencePhotoUrl: operation.payload.evidencePhotoUrl ?? null,
        submittedAt: operation.clientCreatedAt,
        updatedAt: operation.clientCreatedAt,
        lines,
      })
      continue
    }
    const reward = snapshot.rewards.catalog.find((item) => item.id === operation.payload.rewardItemId)
    if (!reward) continue
    const totalCost = reward.pointsCost * operation.payload.quantity
    snapshot.rewards.balance = Math.max(0, snapshot.rewards.balance - totalCost)
    snapshot.rewards.claims.unshift({
      id: `local:${operation.clientOpId}`,
      rewardItemId: reward.id,
      status: "SUBMITTED",
      quantity: operation.payload.quantity,
      pointsCost: totalCost,
      note: operation.payload.note ?? null,
      submittedAt: operation.clientCreatedAt,
      updatedAt: operation.clientCreatedAt,
    })
  }

  return {
    snapshot,
    pendingCount: operations.filter((operation) => operation.status === "pending").length,
    attentionCount: operations.filter(
      (operation) => operation.status === "conflict" || operation.status === "rejected",
    ).length,
  }
}
