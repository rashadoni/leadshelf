import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import {
  AlertRepoError,
  buildOfficeMorningDigest,
  claimPendingNotificationDeliveries,
  detectStockGapAlerts,
  emitProductEvent,
  enqueueOfficeMorningDigest,
  markNotificationDeliveryFailed,
  markNotificationDeliverySent,
} from "../repos/alerts.ts"

const prisma = createSystemClient("alerts-repo-test")
const slug = `test-alerts-${Date.now()}`
let orgId: string
let storeId: string
let productId: string
let otherOrgId: string
let otherStoreId: string

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Alerts Test", slug } })
  orgId = org.id
  const otherOrg = await prisma.organization.create({ data: { name: "Alerts Other", slug: `${slug}-other` } })
  otherOrgId = otherOrg.id
  const otherStore = await prisma.store.create({
    data: { organizationId: otherOrgId, name: "Other Alert Store", code: "AL2" },
  })
  otherStoreId = otherStore.id
  const admin = await prisma.user.create({
    data: { organizationId: orgId, name: "Supervisor", role: "SUPERVISOR", email: `${slug}@example.com` },
  })
  await prisma.mobileDevice.create({
    data: { userId: admin.id, platform: "ios", pushToken: "ExponentPushToken[test]" },
  })
  const inactiveAdmin = await prisma.user.create({
    data: {
      organizationId: orgId,
      name: "Inactive Admin",
      role: "ADMIN",
      email: `${slug}-inactive@example.com`,
      isActive: false,
    },
  })
  await prisma.mobileDevice.create({
    data: { userId: inactiveAdmin.id, platform: "ios", pushToken: "ExponentPushToken[inactive]" },
  })
  const store = await prisma.store.create({ data: { organizationId: orgId, name: "Apteka Alert", code: "AL1" } })
  storeId = store.id
  const product = await prisma.product.create({
    data: { organizationId: orgId, sku: "ALERT-SKU", name: "Alert Product" },
  })
  productId = product.id
  await prisma.storeAssortment.create({ data: { storeId, productId, isActive: true } })
})

afterAll(async () => {
  await prisma.notificationDelivery.deleteMany({ where: { organizationId: orgId } })
  await prisma.alert.deleteMany({ where: { organizationId: orgId } })
  await prisma.productEvent.deleteMany({ where: { organizationId: orgId } })
  await prisma.storeAssortment.deleteMany({ where: { storeId } })
  await prisma.stockSnapshot.deleteMany({ where: { organizationId: orgId } })
  await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.product.deleteMany({ where: { organizationId: orgId } })
  await prisma.store.deleteMany({ where: { organizationId: orgId } })
  await prisma.store.deleteMany({ where: { organizationId: otherOrgId } })
  await prisma.user.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.organization.delete({ where: { id: otherOrgId } })
  await prisma.$disconnect()
})

describe("alerts repo", () => {
  test("emits product event, alert, and push delivery idempotently", async () => {
    const first = await emitProductEvent(prisma, orgId, {
      kind: "visit.anomaly",
      severity: "critical",
      storeId,
      entityType: "visit",
      entityId: "visit-1",
      dedupeKey: "visit.anomaly:visit-1:geofence",
      payload: { title: "Geofence breach", distanceM: 400, limitM: 150 },
    })
    expect(first.created).toBe(true)

    const repeated = await emitProductEvent(prisma, orgId, {
      kind: "visit.anomaly",
      severity: "critical",
      storeId,
      entityType: "visit",
      entityId: "visit-1",
      dedupeKey: "visit.anomaly:visit-1:geofence",
      payload: { title: "Geofence breach" },
    })
    expect(repeated).toMatchObject({ created: false, eventId: first.eventId, alertId: first.alertId })

    expect(await prisma.productEvent.count({ where: { organizationId: orgId } })).toBe(1)
    expect(await prisma.alert.count({ where: { organizationId: orgId, kind: "visit.anomaly" } })).toBe(1)
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { organizationId: orgId, eventId: first.eventId },
    })
    expect(delivery).toMatchObject({
      pushToken: "ExponentPushToken[test]",
      title: "Visit anomalies",
      status: "PENDING",
    })
    expect(await prisma.notificationDelivery.count({ where: { organizationId: orgId, eventId: first.eventId } })).toBe(1)
    expect(
      await prisma.notificationDelivery.count({
        where: { organizationId: orgId, eventId: first.eventId, pushToken: "ExponentPushToken[inactive]" },
      }),
    ).toBe(0)
  })

  test("detects stock gaps from active store assortment", async () => {
    const result = await detectStockGapAlerts(prisma, orgId, {
      date: new Date("2026-07-04T00:00:00.000Z"),
    })
    expect(result.createdCount).toBe(1)
    expect(await prisma.alert.count({ where: { organizationId: orgId, kind: "stock.gap" } })).toBe(1)
  })

  test("builds and enqueues office morning digest", async () => {
    const digest = await buildOfficeMorningDigest(prisma, orgId, {
      since: new Date("2026-07-03T00:00:00.000Z"),
      until: new Date("2026-07-05T00:00:00.000Z"),
    })
    expect(digest.total).toBeGreaterThanOrEqual(2)
    expect(digest.byKind["visit.anomaly"]).toBe(1)

    const queued = await enqueueOfficeMorningDigest(prisma, orgId, {
      since: new Date("2026-07-03T00:00:00.000Z"),
      until: new Date("2026-07-05T00:00:00.000Z"),
      dedupeKey: "morning.digest:test",
    })
    expect(queued.deliveryCount).toBe(1)
    expect(await prisma.productEvent.count({ where: { organizationId: orgId, kind: "office.digest" } })).toBe(1)
  })

  test("rejects cross-tenant store references without writing alert artifacts", async () => {
    await expect(
      emitProductEvent(prisma, orgId, {
        kind: "visit.anomaly",
        severity: "critical",
        storeId: otherStoreId,
        entityType: "visit",
        entityId: "visit-cross-tenant",
        dedupeKey: "visit.anomaly:cross-tenant-store",
        payload: { title: "Cross tenant store" },
      }),
    ).rejects.toBeInstanceOf(AlertRepoError)

    expect(
      await prisma.productEvent.count({
        where: { organizationId: orgId, dedupeKey: "visit.anomaly:cross-tenant-store" },
      }),
    ).toBe(0)
    expect(
      await prisma.alert.count({
        where: { organizationId: orgId, entityId: "visit-cross-tenant" },
      }),
    ).toBe(0)
  })

  test("claims and marks notification deliveries without duplicate sends", async () => {
    const event = await emitProductEvent(prisma, orgId, {
      kind: "task.overdue",
      severity: "warning",
      storeId,
      entityType: "task",
      entityId: "task-delivery-claim",
      dedupeKey: "task.overdue:delivery-claim",
      payload: { title: "Delivery claim task" },
    })

    const claimed = await claimPendingNotificationDeliveries(prisma, orgId, { limit: 20 })
    const delivery = claimed.find((candidate) => candidate.eventId === event.eventId)
    expect(delivery).toBeTruthy()
    expect(await claimPendingNotificationDeliveries(prisma, orgId, { limit: 20 })).not.toContainEqual(
      expect.objectContaining({ id: delivery!.id }),
    )

    expect(await markNotificationDeliverySent(prisma, orgId, delivery!.id, { sentAt: new Date("2026-07-04T08:00:00Z") })).toBe(true)
    await expect(prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery!.id } })).resolves.toMatchObject({
      status: "SENT",
      error: null,
    })

    const failedEvent = await emitProductEvent(prisma, orgId, {
      kind: "import.errors",
      severity: "warning",
      entityType: "import",
      entityId: "import-delivery-failed",
      dedupeKey: "import.errors:delivery-failed",
      payload: { title: "Failed delivery import" },
    })
    const failedDelivery = (await claimPendingNotificationDeliveries(prisma, orgId, { limit: 20 })).find(
      (candidate) => candidate.eventId === failedEvent.eventId,
    )
    expect(failedDelivery).toBeTruthy()
    expect(await markNotificationDeliveryFailed(prisma, orgId, failedDelivery!.id, { error: "expo rejected token" })).toBe(true)
    await expect(prisma.notificationDelivery.findUniqueOrThrow({ where: { id: failedDelivery!.id } })).resolves.toMatchObject({
      status: "FAILED",
      error: "expo rejected token",
    })
  })
})
