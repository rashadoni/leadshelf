import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import { createTemplateWithVersion } from "../repos/equipment.ts"
import { addPlacement, createPlanogramFromTemplate } from "../repos/planogram.ts"
import {
  createNextDraft,
  expireOverdueTasks,
  getTaskSlaSummary,
  publishPlanogramVersion,
  transitionTaskStatus,
} from "../repos/publish.ts"
import { pullChanges, pushOperations } from "../repos/mobile-sync.ts"

const prisma = createSystemClient("publish-repo-test")
const slug = `test-pub-${Date.now()}`
let orgId: string
let formatId: string
let store1: string
let planogramId: string
let versionId: string
let mobileUserId: string
let mobileDeviceId: string

async function revision(vid: string): Promise<string> {
  const v = await prisma.planogramVersion.findUnique({
    where: { id: vid },
    select: { updatedAt: true },
  })
  return v!.updatedAt.toISOString()
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Pub Test", slug } })
  orgId = org.id
  const mobileUser = await prisma.user.create({
    data: {
      organizationId: orgId,
      name: "Store Staff",
      employeeCode: "MOB-1",
      role: "STORE_STAFF",
    },
  })
  mobileUserId = mobileUser.id
  const mobileDevice = await prisma.mobileDevice.create({
    data: {
      userId: mobileUserId,
      platform: "expo",
      deviceName: "Test phone",
    },
  })
  mobileDeviceId = mobileDevice.id
  const format = await prisma.storeFormat.create({
    data: { organizationId: orgId, name: "Standart" },
  })
  formatId = format.id
  const s1 = await prisma.store.create({
    data: { organizationId: orgId, name: "Аптека 1", code: "S1", formatId },
  })
  store1 = s1.id
  await prisma.store.create({
    data: { organizationId: orgId, name: "Аптека 2", code: "S2", formatId },
  })
  const type = await prisma.equipmentType.create({
    data: { organizationId: orgId, name: "Rəf", kind: "rack" },
  })
  const tpl = await createTemplateWithVersion(prisma, orgId, {
    name: "Стеллаж",
    typeId: type.id,
    geometry: { widthMm: 1200, heightMm: 1800, depthMm: 300 },
    shelves: [{ shelfIndex: 0, yMm: 50, thicknessMm: 20, depthMm: 300 }],
  })
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      sku: "P-1",
      name: "Товар",
      widthMm: 75,
      heightMm: 150,
      depthMm: 60,
    },
  })
  const plano = await createPlanogramFromTemplate(prisma, orgId, {
    name: "Полка OTC",
    equipmentTemplateId: tpl.templateId,
  })
  planogramId = plano.planogramId
  versionId = plano.versionId
  const editor = await prisma.planogramVersion.findUnique({
    where: { id: versionId },
    include: { equipment: { include: { equipmentVersion: { include: { shelves: true } } } } },
  })
  const placement = await addPlacement(prisma, orgId, {
    planogramVersionId: versionId,
    expectedRevision: await revision(versionId),
    shelfId: editor!.equipment[0]!.equipmentVersion.shelves[0]!.id,
    productId: product.id,
    facingsX: 4,
    facingsY: 1,
    facingsZ: 1,
  })
  await prisma.planogramPlacement.update({
    where: { id: placement.placementId },
    data: { compressionX: 0.8 },
  })
})

afterAll(async () => {
  await prisma.notificationDelivery.deleteMany({ where: { organizationId: orgId } })
  await prisma.alert.deleteMany({ where: { organizationId: orgId } })
  await prisma.productEvent.deleteMany({ where: { organizationId: orgId } })
  await prisma.outboxOperation.deleteMany({ where: { device: { user: { organizationId: orgId } } } })
  await prisma.syncConflict.deleteMany({ where: { device: { user: { organizationId: orgId } } } })
  await prisma.syncCursor.deleteMany({ where: { device: { user: { organizationId: orgId } } } })
  await prisma.agentLocation.deleteMany({ where: { agent: { organizationId: orgId } } })
  await prisma.visit.deleteMany({ where: { organizationId: orgId } })
  await prisma.route.deleteMany({ where: { organizationId: orgId } })
  await prisma.fieldAgent.deleteMany({ where: { organizationId: orgId } })
  await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.taskComment.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.photoSubmission.deleteMany({ where: { organizationId: orgId } })
  await prisma.task.deleteMany({ where: { organizationId: orgId } })
  await prisma.planogramPlacement.deleteMany({
    where: { planogramVersion: { planogram: { organizationId: orgId } } },
  })
  await prisma.planogram.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("publish", () => {
  test("пустую планограмму публиковать нельзя", async () => {
    const empty = await createPlanogramFromTemplate(prisma, orgId, {
      name: "Пустая",
      equipmentTemplateId: (await prisma.equipmentTemplate.findFirstOrThrow({
        where: { organizationId: orgId },
      })).id,
    })
    await expect(
      publishPlanogramVersion(prisma, orgId, {
        planogramId: empty.planogramId,
        versionId: empty.versionId,
        expectedRevision: await revision(empty.versionId),
        target: { type: "FORMAT", formatId },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" })
  })

  test("publish на формат: PUBLISHED + freeze + assignment + задачи на все точки", async () => {
    const result = await publishPlanogramVersion(prisma, orgId, {
      planogramId,
      versionId,
      expectedRevision: await revision(versionId),
      target: { type: "FORMAT", formatId },
      dueAt: new Date("2026-07-10T00:00:00Z"),
    })
    expect(result.resolvedStoreCount).toBe(2)
    expect(result.taskIds).toHaveLength(2)

    const version = await prisma.planogramVersion.findUnique({
      where: { id: versionId },
      include: { equipment: { include: { equipmentVersion: true } } },
    })
    expect(version?.state).toBe("PUBLISHED")
    expect(version?.publishedAt).toBeTruthy()
    expect(version?.equipment[0]?.equipmentVersion.isFrozen).toBe(true)

    const tasks = await prisma.task.findMany({ where: { planogramVersionId: versionId } })
    expect(tasks.every((t) => t.status === "NEW")).toBe(true)
    expect(
      await prisma.taskStatusHistory.count({ where: { taskId: { in: tasks.map((t) => t.id) } } }),
    ).toBe(2)
  })

  test("двойной publish -> version_conflict; правка PUBLISHED заблокирована БД-триггером", async () => {
    await expect(
      publishPlanogramVersion(prisma, orgId, {
        planogramId,
        versionId,
        expectedRevision: await revision(versionId),
        target: { type: "FORMAT", formatId },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" }) // уже не DRAFT

    // прямой INSERT в контент опубликованной версии режет триггер
    const eq = await prisma.planogramEquipment.findFirstOrThrow({
      where: { planogramVersionId: versionId },
    })
    await expect(
      prisma.planogramPlacement.create({
        data: {
          planogramVersionId: versionId,
          planogramEquipmentId: eq.id,
          productId: (await prisma.product.findFirstOrThrow({ where: { organizationId: orgId } })).id,
          xMm: 900,
          yMm: 70,
          widthMm: 10,
          heightMm: 10,
          depthMm: 10,
        },
      }),
    ).rejects.toThrow(/not DRAFT/)
  })

  test("повторный publish на занятые точки -> overlap reject (после next-draft)", async () => {
    const draft = await createNextDraft(prisma, orgId, {
      planogramId,
      sourceVersionId: versionId,
    })
    expect(draft.created).toBe(true)
    expect(draft.versionNumber).toBe(2)
    // клон принес placements
    expect(
      await prisma.planogramPlacement.count({ where: { planogramVersionId: draft.versionId } }),
    ).toBe(1)
    // повторный вызов возвращает тот же draft
    const again = await createNextDraft(prisma, orgId, { planogramId, sourceVersionId: versionId })
    expect(again.created).toBe(false)
    expect(again.versionId).toBe(draft.versionId)

    await expect(
      publishPlanogramVersion(prisma, orgId, {
        planogramId,
        versionId: draft.versionId,
        expectedRevision: await revision(draft.versionId),
        target: { type: "STORES", storeIds: [store1] },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" }) // активное назначение уже висит
  })

  test("FSM задач: валидная цепочка + запрет из терминального", async () => {
    const task = await prisma.task.findFirstOrThrow({
      where: { planogramVersionId: versionId, storeId: store1 },
    })
    await transitionTaskStatus(prisma, orgId, {
      taskId: task.id,
      expectedStatus: "NEW",
      toStatus: "IN_PROGRESS",
    })
    await transitionTaskStatus(prisma, orgId, {
      taskId: task.id,
      expectedStatus: "IN_PROGRESS",
      toStatus: "PHOTO_SUBMITTED",
    })
    const done = await transitionTaskStatus(prisma, orgId, {
      taskId: task.id,
      expectedStatus: "PHOTO_SUBMITTED",
      toStatus: "COMPLETED",
    })
    expect(done.status).toBe("COMPLETED")

    await expect(
      transitionTaskStatus(prisma, orgId, {
        taskId: task.id,
        expectedStatus: "COMPLETED",
        toStatus: "NEW",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" })

    // NEW -> COMPLETED без промежуточных запрещен
    const other = await prisma.task.findFirstOrThrow({
      where: { planogramVersionId: versionId, status: "NEW" },
    })
    await expect(
      transitionTaskStatus(prisma, orgId, {
        taskId: other.id,
        expectedStatus: "NEW",
        toStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" })
  })

  test("autо-expire: overdue open tasks -> EXPIRED с history, terminal не трогает", async () => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: store1 } })
    const oldOpen = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store.id,
        title: "Overdue new",
        status: "NEW",
        dueAt: new Date("2026-07-01T10:00:00Z"),
      },
    })
    const oldPhoto = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store.id,
        title: "Overdue photo",
        status: "PHOTO_SUBMITTED",
        dueAt: new Date("2026-07-01T11:00:00Z"),
      },
    })
    const oldDone = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store.id,
        title: "Done overdue",
        status: "COMPLETED",
        dueAt: new Date("2026-07-01T12:00:00Z"),
      },
    })

    const result = await expireOverdueTasks(prisma, orgId, {
      now: new Date("2026-07-02T00:00:00Z"),
    })

    expect(result.expiredCount).toBeGreaterThanOrEqual(2)
    expect(result.taskIds).toEqual(expect.arrayContaining([oldOpen.id, oldPhoto.id]))
    await expect(prisma.task.findUniqueOrThrow({ where: { id: oldOpen.id } })).resolves.toMatchObject({
      status: "EXPIRED",
    })
    await expect(prisma.task.findUniqueOrThrow({ where: { id: oldPhoto.id } })).resolves.toMatchObject({
      status: "EXPIRED",
    })
    await expect(prisma.task.findUniqueOrThrow({ where: { id: oldDone.id } })).resolves.toMatchObject({
      status: "COMPLETED",
    })
    expect(
      await prisma.taskStatusHistory.count({
        where: { taskId: { in: [oldOpen.id, oldPhoto.id] }, toStatus: "EXPIRED" },
      }),
    ).toBe(2)
  })

  test("SLA summary считает открытые, due today, expired и unassigned", async () => {
    const summary = await getTaskSlaSummary(prisma, orgId, {
      now: new Date("2026-07-10T12:00:00Z"),
    })
    expect(summary.open).toBeGreaterThanOrEqual(0)
    expect(summary.dueToday).toBeGreaterThanOrEqual(0)
    expect(summary.expired).toBeGreaterThanOrEqual(2)
    expect(summary.completed).toBeGreaterThanOrEqual(1)
    expect(summary.unassignedOpen).toBeGreaterThanOrEqual(0)
  })

  test("mobile pull отдает floor-plan location hint для назначенной задачи", async () => {
    const task = await prisma.task.findFirstOrThrow({
      where: { planogramVersionId: versionId, storeId: store1 },
    })
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: mobileUserId } })
    const planogramEquipment = await prisma.planogramEquipment.findFirstOrThrow({
      where: { planogramVersionId: versionId },
      select: { equipmentVersionId: true },
    })
    const floorPlan = await prisma.floorPlan.create({
      data: { organizationId: orgId, formatId, name: "Main floor" },
    })
    const floorPlanVersion = await prisma.floorPlanVersion.create({
      data: {
        floorPlanId: floorPlan.id,
        versionNumber: 1,
        widthMm: 10000,
        depthMm: 8000,
        isPublished: true,
        publishedAt: new Date("2026-07-03T00:00:00Z"),
      },
    })
    await prisma.floorPlanEquipment.create({
      data: {
        floorPlanVersionId: floorPlanVersion.id,
        equipmentVersionId: planogramEquipment.equipmentVersionId,
        planogramId,
        label: "Aisle A / Bay 03",
        xMm: 1200,
        yMm: 2400,
        rotationDeg: 90,
      },
    })

    const pulled = await pullChanges(prisma, orgId, mobileUserId, {})
    const mobileTask = pulled.tasks.find((t) => t.id === task.id)

    expect(mobileTask?.locationHint).toMatchObject({
      source: "FORMAT_FLOOR_PLAN",
      floorPlanName: "Main floor",
      label: "Aisle A / Bay 03",
      equipmentName: "Стеллаж",
      xMm: 1200,
      yMm: 2400,
      rotationDeg: 90,
    })
  })

  test("mobile pull сохраняет compressionX в immutable planogram bundle", async () => {
    const task = await prisma.task.findFirstOrThrow({
      where: { planogramVersionId: versionId, storeId: store1 },
    })
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: mobileUserId } })

    const pulled = await pullChanges(prisma, orgId, mobileUserId, {})
    const bundle = pulled.planogramBundles.find((item) => item.versionId === versionId)

    expect(bundle?.placements[0]).toMatchObject({ compressionX: 0.8, facingsX: 4 })
  })

  test("mobile task.comment сохраняет feedback идемпотентно", async () => {
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store1,
        assigneeId: mobileUserId,
        title: "Comment task",
        status: "IN_PROGRESS",
      },
    })

    const first = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [
      {
        clientOpId: "op-comment-0001",
        kind: "task.comment",
        payload: { taskId: task.id, body: "  Не хватает ценника  " },
      },
    ])
    const second = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [
      {
        clientOpId: "op-comment-0001",
        kind: "task.comment",
        payload: { taskId: task.id, body: "duplicate delivery" },
      },
    ])

    expect(first).toEqual([{ clientOpId: "op-comment-0001", status: "applied" }])
    expect(second).toEqual(first)
    await expect(prisma.taskComment.findMany({ where: { taskId: task.id } })).resolves.toMatchObject([
      { body: "Не хватает ценника", userId: mobileUserId },
    ])
  })

  test("mobile push переживает потерянный ответ без дублей status/photo/comment", async () => {
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store1,
        assigneeId: mobileUserId,
        title: "Offline proof task",
        status: "NEW",
      },
    })
    await prisma.photoSubmission.create({
      data: {
        organizationId: orgId,
        storeId: store1,
        taskId: task.id,
        userId: mobileUserId,
        url: `photos/${orgId}/${task.id}/photo-lost-response-0001.jpg`,
        clientPhotoId: "photo-lost-response-0001",
        takenAt: new Date("2026-07-04T08:00:00Z"),
      },
    })

    const operations = [
      {
        clientOpId: "op-lost-status-0001",
        kind: "task.status" as const,
        payload: { taskId: task.id, expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      },
      {
        clientOpId: "op-lost-photo-0001",
        kind: "photo.submit" as const,
        payload: { clientPhotoId: "photo-lost-response-0001", taskId: task.id },
      },
      {
        clientOpId: "op-lost-comment-0001",
        kind: "task.comment" as const,
        payload: { taskId: task.id, body: "  Offline proof uploaded  " },
      },
    ]

    const first = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, operations)
    const second = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, operations)

    expect(second).toEqual(first)
    expect(first).toEqual([
      { clientOpId: "op-lost-status-0001", status: "applied" },
      { clientOpId: "op-lost-photo-0001", status: "applied" },
      { clientOpId: "op-lost-comment-0001", status: "applied" },
    ])
    await expect(prisma.task.findUnique({ where: { id: task.id }, select: { status: true } })).resolves.toEqual({
      status: "PHOTO_SUBMITTED",
    })
    await expect(prisma.taskComment.count({ where: { taskId: task.id } })).resolves.toBe(1)
    await expect(prisma.photoSubmission.count({ where: { taskId: task.id } })).resolves.toBe(1)
    await expect(prisma.taskStatusHistory.count({ where: { taskId: task.id } })).resolves.toBe(2)
    await expect(
      prisma.outboxOperation.count({
        where: { deviceId: mobileDeviceId, clientOpId: { in: operations.map((operation) => operation.clientOpId) } },
      }),
    ).resolves.toBe(3)
  })

  test("mobile pull возвращает серверный photo review и обновляет его по курсору", async () => {
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        storeId: store1,
        assigneeId: mobileUserId,
        title: "Review sync task",
        status: "PHOTO_SUBMITTED",
      },
    })
    const photo = await prisma.photoSubmission.create({
      data: {
        organizationId: orgId,
        storeId: store1,
        taskId: task.id,
        userId: mobileUserId,
        url: `photos/${orgId}/${task.id}/photo-review-sync-0001.jpg`,
        clientPhotoId: "photo-review-sync-0001",
        takenAt: new Date("2026-07-04T08:00:00Z"),
        qualityScore: 0.42,
        createdAt: new Date("2026-07-04T08:01:00Z"),
      },
    })
    const review = await prisma.humanReview.create({
      data: {
        organizationId: orgId,
        reason: "PHOTO_QUALITY",
        status: "PENDING",
        taskId: task.id,
        photoSubmissionId: photo.id,
        score: 0.42,
        note: "Фото размыто, нужна проверка",
        createdAt: new Date("2026-07-04T08:02:00Z"),
        updatedAt: new Date("2026-07-04T08:02:00Z"),
      },
    })

    const first = await pullChanges(prisma, orgId, mobileUserId, {})
    expect(first.photoSubmissions).toContainEqual(
      expect.objectContaining({
        id: photo.id,
        clientPhotoId: "photo-review-sync-0001",
        taskId: task.id,
        key: `photos/${orgId}/${task.id}/photo-review-sync-0001.jpg`,
        qualityScore: 0.42,
        review: expect.objectContaining({
          id: review.id,
          reason: "PHOTO_QUALITY",
          status: "PENDING",
          note: "Фото размыто, нужна проверка",
        }),
      }),
    )

    await prisma.humanReview.update({
      where: { id: review.id },
      data: {
        status: "APPROVED",
        note: "Фото принято",
        reviewedAt: new Date("2026-07-04T08:05:00Z"),
        updatedAt: new Date("2099-07-04T08:05:00Z"),
      },
    })

    const second = await pullChanges(prisma, orgId, mobileUserId, {
      photoSubmissions: first.cursors.photoSubmissions,
    })
    expect(second.photoSubmissions).toEqual([
      expect.objectContaining({
        id: photo.id,
        review: expect.objectContaining({
          status: "APPROVED",
          note: "Фото принято",
          reviewedAt: "2026-07-04T08:05:00.000Z",
        }),
      }),
    ])
  })

  test("mobile routes/visits: pull route, replay check-in once, and checkout safely", async () => {
    await prisma.store.update({
      where: { id: store1 },
      data: { latitude: 40.4093, longitude: 49.8671 },
    })
    const agent = await prisma.fieldAgent.create({
      data: {
        organizationId: orgId,
        userId: mobileUserId,
        employeeCode: "FIELD-1",
      },
    })
    const route = await prisma.route.create({
      data: {
        organizationId: orgId,
        agentId: agent.id,
        name: "Morning route",
        stops: { create: [{ storeId: store1, sortOrder: 1, plannedAt: new Date("2026-07-04T09:00:00Z") }] },
      },
      include: { stops: true },
    })
    const stop = route.stops[0]!

    const pulled = await pullChanges(prisma, orgId, mobileUserId, {})

    expect(pulled.routes).toEqual([
      expect.objectContaining({
        id: route.id,
        agentId: agent.id,
        stops: [
          expect.objectContaining({
            id: stop.id,
            storeId: store1,
            sortOrder: 1,
            plannedAt: "2026-07-04T09:00:00.000Z",
          }),
        ],
      }),
    ])
    expect(pulled.stores.some((store) => store.id === store1)).toBe(true)

    const checkInOp = {
      clientOpId: "op-visit-checkin-0001",
      kind: "visit.checkin" as const,
      payload: {
        agentId: agent.id,
        storeId: store1,
        routeStopId: stop.id,
        latitude: 40.40931,
        longitude: 49.86709,
        geofenceLimitM: 150,
      },
    }
    const firstCheckIn = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [checkInOp])
    const replayedCheckIn = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [checkInOp])
    const duplicateActiveCheckIn = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [
      {
        ...checkInOp,
        clientOpId: "op-visit-checkin-0002",
      },
    ])
    const visitId = (firstCheckIn[0]?.detail as { visitId?: string } | undefined)?.visitId

    expect(visitId).toBeTruthy()
    expect(replayedCheckIn).toEqual(firstCheckIn)
    expect(duplicateActiveCheckIn).toEqual([
      expect.objectContaining({
        clientOpId: "op-visit-checkin-0002",
        status: "already_applied",
        detail: expect.objectContaining({ visitId }),
      }),
    ])
    await expect(prisma.visit.count({ where: { organizationId: orgId, agentId: agent.id, routeStopId: stop.id } })).resolves.toBe(1)
    await expect(prisma.agentLocation.count({ where: { agentId: agent.id } })).resolves.toBe(1)

    const checkoutOp = {
      clientOpId: "op-visit-checkout-0001",
      kind: "visit.checkout" as const,
      payload: { visitId: visitId! },
    }
    const firstCheckout = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [checkoutOp])
    const replayedCheckout = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [checkoutOp])
    const secondCheckout = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [
      {
        clientOpId: "op-visit-checkout-0002",
        kind: "visit.checkout",
        payload: { visitId: visitId! },
      },
    ])

    expect(firstCheckout).toEqual([{ clientOpId: "op-visit-checkout-0001", status: "applied" }])
    expect(replayedCheckout).toEqual(firstCheckout)
    expect(secondCheckout).toEqual([
      {
        clientOpId: "op-visit-checkout-0002",
        status: "already_applied",
        detail: { serverStatus: "COMPLETED" },
      },
    ])
    await expect(prisma.visit.findUnique({ where: { id: visitId! }, select: { status: true } })).resolves.toEqual({
      status: "COMPLETED",
    })
  })
})
