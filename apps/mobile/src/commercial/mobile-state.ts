import { EMPTY_MOBILE_COMMERCIAL_SNAPSHOT } from "@leadshelf/api-contracts/mobile/v1"
import {
  getStore,
  listCommercialOperations,
  listQueuedOrders,
  listVisits,
  readCommercialSnapshot,
  type LocalCommercialOperation,
  type QueuedOrderRow,
} from "../db/local-store"
import type { StoreRow, VisitRow } from "../sync/ports"
import { projectCommercialSnapshot, type CommercialProjection } from "./offline-state"

export interface CommercialMobileState extends CommercialProjection {
  activeVisit: VisitRow | null
  activeStore: StoreRow | null
  cachedAt: string | null
  operations: LocalCommercialOperation[]
  queuedOrders: QueuedOrderRow[]
}

export function readCommercialMobileState(): CommercialMobileState {
  const cached = readCommercialSnapshot()
  const operations = listCommercialOperations()
  const projected = projectCommercialSnapshot(
    cached?.value ?? EMPTY_MOBILE_COMMERCIAL_SNAPSHOT,
    operations,
  )
  const activeVisit = listVisits().find((visit) => visit.status === "IN_PROGRESS") ?? null
  return {
    ...projected,
    activeVisit,
    activeStore: activeVisit ? getStore(activeVisit.storeId) : null,
    cachedAt: cached?.updatedAt ?? null,
    operations,
    queuedOrders: listQueuedOrders(),
  }
}

export function commercialOrderTotal(state: CommercialMobileState): number {
  return state.snapshot.orders.reduce((sum, order) => sum + order.totalAmount, 0)
}

export function activePromotionCount(state: CommercialMobileState, now = Date.now()): number {
  return state.snapshot.promotions.filter((promotion) => {
    const startsAt = Date.parse(promotion.activeFrom)
    const endsAt = promotion.activeTo ? Date.parse(promotion.activeTo) : Number.POSITIVE_INFINITY
    return startsAt <= now && endsAt >= now
  }).length
}
