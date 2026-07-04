import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient, emitProductEvent, type NotificationDeliveryJob } from "@leadshelf/db"
import { processPendingNotificationDeliveries, type PushSender } from "./push"

const prisma = createSystemClient("notification-worker-test")
const slug = `test-notifications-${Date.now()}`
let orgId: string
let okStoreId: string
let failStoreId: string

class FakeSender implements PushSender {
  sent: NotificationDeliveryJob[] = []

  async send(job: NotificationDeliveryJob) {
    this.sent.push(job)
    if (job.pushToken.includes("fail")) return { ok: false, error: "fake_rejected" }
    return { ok: true, providerId: `fake-${job.id}` }
  }
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Notification Worker Test", slug } })
  orgId = org.id
  const okUser = await prisma.user.create({
    data: { organizationId: orgId, name: "Push OK", role: "ADMIN", email: `${slug}-ok@example.com` },
  })
  const failUser = await prisma.user.create({
    data: { organizationId: orgId, name: "Push Fail", role: "SUPERVISOR", email: `${slug}-fail@example.com` },
  })
  await prisma.mobileDevice.create({ data: { userId: okUser.id, platform: "ios", pushToken: "ExponentPushToken[ok]" } })
  await prisma.mobileDevice.create({ data: { userId: failUser.id, platform: "android", pushToken: "ExponentPushToken[fail]" } })
  const okStore = await prisma.store.create({ data: { organizationId: orgId, name: "OK Store", code: "N-OK" } })
  const failStore = await prisma.store.create({ data: { organizationId: orgId, name: "Fail Store", code: "N-FAIL" } })
  okStoreId = okStore.id
  failStoreId = failStore.id
})

afterAll(async () => {
  await prisma.notificationDelivery.deleteMany({ where: { organizationId: orgId } })
  await prisma.alert.deleteMany({ where: { organizationId: orgId } })
  await prisma.productEvent.deleteMany({ where: { organizationId: orgId } })
  await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.store.deleteMany({ where: { organizationId: orgId } })
  await prisma.user.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("notification delivery worker", () => {
  test("claims pending deliveries and marks provider result", async () => {
    await emitProductEvent(prisma, orgId, {
      kind: "task.overdue",
      severity: "warning",
      storeId: okStoreId,
      entityType: "task",
      entityId: "task-ok",
      dedupeKey: "notification-worker:task-ok",
      payload: { title: "Task overdue" },
    })
    await emitProductEvent(prisma, orgId, {
      kind: "visit.anomaly",
      severity: "critical",
      storeId: failStoreId,
      entityType: "visit",
      entityId: "visit-fail",
      dedupeKey: "notification-worker:visit-fail",
      payload: { title: "Visit anomaly" },
    })

    const sender = new FakeSender()
    const result = await processPendingNotificationDeliveries(prisma, orgId, { sender })

    expect(result).toEqual({ claimed: 4, sent: 2, failed: 2 })
    expect(sender.sent).toHaveLength(4)
    expect(await prisma.notificationDelivery.count({ where: { organizationId: orgId, status: "PENDING" } })).toBe(0)
    expect(await prisma.notificationDelivery.count({ where: { organizationId: orgId, status: "SENT" } })).toBe(2)
    expect(await prisma.notificationDelivery.count({ where: { organizationId: orgId, status: "FAILED", error: "fake_rejected" } })).toBe(2)
  })
})
