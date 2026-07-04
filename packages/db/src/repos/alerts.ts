import { Prisma, type PrismaClient } from "@prisma/client"
import {
  buildAlertMessage,
  buildMorningDigest,
  buildPushPayload,
  type AlertSeverity,
  type ProductEventKind,
} from "@leadshelf/core"

const OFFICE_PUSH_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"] as const

export class AlertRepoError extends Error {
  constructor(
    public code: "store_not_found",
    message = code,
    public detail?: unknown,
  ) {
    super(message)
  }
}

export interface EmitProductEventInput {
  kind: ProductEventKind
  severity?: AlertSeverity
  storeId?: string | null
  entityType?: string | null
  entityId?: string | null
  dedupeKey?: string | null
  payload?: Record<string, unknown> | null
  occurredAt?: Date
}

function defaultDedupeKey(input: EmitProductEventInput): string {
  return [
    input.kind,
    input.entityType ?? "none",
    input.entityId ?? "none",
    input.storeId ?? "none",
  ].join(":")
}

async function findExistingEvent(prisma: PrismaClient, organizationId: string, dedupeKey: string) {
  return prisma.productEvent.findFirst({
    where: { organizationId, dedupeKey },
    include: { alert: true },
  })
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}

function payloadString(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = payload?.[key]
  return typeof value === "string" && value.trim() ? value : null
}

function payloadNumber(payload: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = payload?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export async function emitProductEvent(
  prisma: PrismaClient,
  organizationId: string,
  input: EmitProductEventInput,
) {
  const dedupeKey = input.dedupeKey ?? defaultDedupeKey(input)
  const existing = await findExistingEvent(prisma, organizationId, dedupeKey)
  if (existing) {
    return { eventId: existing.id, alertId: existing.alert?.id ?? null, created: false }
  }

  const store = input.storeId
    ? await prisma.store.findFirst({
        where: { id: input.storeId, organizationId },
        select: { id: true, name: true },
      })
    : null
  if (input.storeId && !store) {
    throw new AlertRepoError("store_not_found", "store_not_found", { storeId: input.storeId })
  }
  const message = buildAlertMessage({
    kind: input.kind,
    severity: input.severity,
    storeName: store?.name ?? null,
    entityTitle: payloadString(input.payload, "title"),
    count: payloadNumber(input.payload, "count"),
  })

  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.productEvent.create({
        data: {
          organizationId,
          kind: input.kind,
          severity: message.severity,
          storeId: store?.id ?? input.storeId ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey,
          payload: (input.payload ?? {}) as Prisma.InputJsonObject,
          occurredAt: input.occurredAt ?? new Date(),
        },
      })
      const alert = await tx.alert.create({
        data: {
          organizationId,
          eventId: event.id,
          kind: input.kind,
          severity: message.severity,
          storeId: store?.id ?? input.storeId ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          payload: {
            ...(input.payload ?? {}),
            title: message.title,
            body: message.body,
          } as Prisma.InputJsonObject,
        },
      })

      const push = buildPushPayload({
        eventId: event.id,
        alertId: alert.id,
        kind: input.kind,
        severity: message.severity,
        storeName: store?.name ?? null,
        entityTitle: payloadString(input.payload, "title"),
        count: payloadNumber(input.payload, "count"),
      })
      const devices = await tx.mobileDevice.findMany({
        where: {
          pushToken: { not: null },
          user: { organizationId, role: { in: [...OFFICE_PUSH_ROLES] } },
        },
        select: { id: true, pushToken: true },
      })
      for (const device of devices) {
        if (!device.pushToken) continue
        await tx.notificationDelivery.create({
          data: {
            organizationId,
            eventId: event.id,
            alertId: alert.id,
            deviceId: device.id,
            pushToken: device.pushToken,
            title: push.title,
            body: push.body,
            payload: push.data as Prisma.InputJsonObject,
          },
        })
      }

      return { eventId: event.id, alertId: alert.id, created: true }
    })
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existingAfterRace = await findExistingEvent(prisma, organizationId, dedupeKey)
      if (existingAfterRace) {
        return {
          eventId: existingAfterRace.id,
          alertId: existingAfterRace.alert?.id ?? null,
          created: false,
        }
      }
    }
    throw error
  }
}

export async function buildOfficeMorningDigest(
  prisma: PrismaClient,
  organizationId: string,
  input: { since?: Date; until?: Date } = {},
) {
  const until = input.until ?? new Date()
  const since = input.since ?? new Date(until.getTime() - 24 * 60 * 60 * 1000)
  const alerts = await prisma.alert.findMany({
    where: {
      organizationId,
      isResolved: false,
      createdAt: { gte: since, lt: until },
    },
    select: { kind: true, severity: true },
  })
  return buildMorningDigest(
    alerts.flatMap((alert) => {
      const allowedKinds: ProductEventKind[] = ["task.overdue", "visit.anomaly", "stock.gap", "import.errors"]
      if (!allowedKinds.includes(alert.kind as ProductEventKind)) return []
      return [
        {
          kind: alert.kind as ProductEventKind,
          severity: alert.severity as AlertSeverity,
          storeName: null,
        },
      ]
    }),
  )
}

export async function enqueueOfficeMorningDigest(
  prisma: PrismaClient,
  organizationId: string,
  input: { since?: Date; until?: Date; dedupeKey?: string } = {},
) {
  const digest = await buildOfficeMorningDigest(prisma, organizationId, input)
  if (digest.total === 0) return { deliveryCount: 0, digest }

  const until = input.until ?? new Date()
  const eventResult = await emitProductEvent(prisma, organizationId, {
    kind: "office.digest",
    severity: digest.critical > 0 ? "critical" : "warning",
    entityType: "digest",
    entityId: until.toISOString().slice(0, 10),
    dedupeKey: input.dedupeKey ?? `morning.digest:${until.toISOString().slice(0, 10)}`,
    payload: {
      title: digest.title,
      count: digest.total,
      digest,
    },
    occurredAt: until,
  })
  const deliveries = await prisma.notificationDelivery.count({
    where: { organizationId, eventId: eventResult.eventId },
  })
  return { deliveryCount: deliveries, digest, eventId: eventResult.eventId }
}

export async function detectStockGapAlerts(
  prisma: PrismaClient,
  organizationId: string,
  input: { date?: Date; limit?: number } = {},
) {
  const date = input.date ?? new Date()
  const limit = input.limit ?? 200
  const assortment = await prisma.storeAssortment.findMany({
    where: { isActive: true, store: { organizationId, isActive: true }, product: { isActive: true } },
    take: limit,
    include: {
      store: { select: { id: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  })
  const created: string[] = []
  for (const row of assortment) {
    const latest = await prisma.stockSnapshot.findFirst({
      where: { organizationId, storeId: row.storeId, productId: row.productId, date: { lte: date } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { quantity: true },
    })
    if (latest && Number(latest.quantity) > 0) continue
    const result = await emitProductEvent(prisma, organizationId, {
      kind: "stock.gap",
      severity: "warning",
      storeId: row.storeId,
      entityType: "product",
      entityId: row.productId,
      dedupeKey: `stock.gap:${row.storeId}:${row.productId}:${date.toISOString().slice(0, 10)}`,
      payload: { title: row.product.name, sku: row.product.sku, count: 1 },
      occurredAt: date,
    })
    if (result.created) created.push(result.eventId)
  }
  return { createdCount: created.length, eventIds: created, hasMore: assortment.length === limit }
}
