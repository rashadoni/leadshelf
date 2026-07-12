import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import { createTemplateWithVersion } from "../repos/equipment.ts"
import { addPlacement, createPlanogramFromTemplate } from "../repos/planogram.ts"
import { publishPlanogramVersion } from "../repos/publish.ts"
import { pullChanges, pushOperations } from "../repos/mobile-sync.ts"

// Регрессия для детерминированной свежей photo-proof задачи (docs/31,
// seed-demo ensureFreshProofTask). Гарантирует зелёный Android flow на
// серверном/протокольном слое БЕЗ устройства: свежая IN_PROGRESS задача на
// опубликованной планограмме с capture template ->
//   1) pull отдаёт captureTemplate (резолв по типу оборудования) + bundle;
//   2) photo.submit из IN_PROGRESS -> applied (не conflict/rejected);
//   3) повтор того же clientOpId -> already_applied без дубля фото.
// Раньше pull-резолв captureTemplate тестами не покрывался.

const prisma = createSystemClient("mobile-photo-proof-test")
const slug = `test-proof-${Date.now()}`

let orgId: string
let storeId: string
let versionId: string
let planogramId: string
let taskId: string
let rackTypeId: string
let mobileUserId: string
let mobileDeviceId: string

const RACK_STEPS = [
  { id: "front", kind: "front", required: true, sequence: 1, mediaKind: "photo", burstCount: 3, tiltToleranceDeg: 6 },
  { id: "left-depth", kind: "left_depth", required: true, sequence: 2, mediaKind: "photo", burstCount: 3, compositionHint: "edge_left", depthMode: "angle_photo" },
  { id: "detail", kind: "detail", required: false, sequence: 3, mediaKind: "photo", burstCount: 1, compositionHint: "close_up" },
]

async function revision(vid: string): Promise<string> {
  const v = await prisma.planogramVersion.findUniqueOrThrow({
    where: { id: vid },
    select: { updatedAt: true },
  })
  return v.updatedAt.toISOString()
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Proof Test", slug } })
  orgId = org.id
  const mobileUser = await prisma.user.create({
    data: { organizationId: orgId, name: "Field merch", employeeCode: "M-PROOF", role: "MERCHANDISER" },
  })
  mobileUserId = mobileUser.id
  const device = await prisma.mobileDevice.create({
    data: { userId: mobileUserId, platform: "expo", deviceName: "Proof phone" },
  })
  mobileDeviceId = device.id
  const format = await prisma.storeFormat.create({ data: { organizationId: orgId, name: "Standart" } })
  const store = await prisma.store.create({
    data: { organizationId: orgId, name: "Аптека Proof", code: "S-PROOF", formatId: format.id },
  })
  storeId = store.id

  const rackType = await prisma.equipmentType.create({
    data: { organizationId: orgId, name: "Стеллаж", kind: "rack" },
  })
  rackTypeId = rackType.id
  // Capture template по типу оборудования планограммы (как ensureCaptureTemplate).
  await prisma.captureTemplate.create({
    data: {
      organizationId: orgId,
      equipmentTypeId: rackTypeId,
      name: "Стеллаж: front + глубина",
      steps: RACK_STEPS,
    },
  })

  const tpl = await createTemplateWithVersion(prisma, orgId, {
    name: "Стеллаж OTC",
    typeId: rackTypeId,
    geometry: { widthMm: 1200, heightMm: 1800, depthMm: 300 },
    shelves: [{ shelfIndex: 0, yMm: 50, thicknessMm: 20, depthMm: 300 }],
  })
  const product = await prisma.product.create({
    data: { organizationId: orgId, sku: "OTC-PROOF", name: "Товар", widthMm: 75, heightMm: 150, depthMm: 60 },
  })
  const plano = await createPlanogramFromTemplate(prisma, orgId, {
    name: "OTC proof",
    equipmentTemplateId: tpl.templateId,
  })
  planogramId = plano.planogramId
  versionId = plano.versionId
  const editor = await prisma.planogramVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { equipment: { include: { equipmentVersion: { include: { shelves: true } } } } },
  })
  await addPlacement(prisma, orgId, {
    planogramVersionId: versionId,
    expectedRevision: await revision(versionId),
    shelfId: editor.equipment[0]!.equipmentVersion.shelves[0]!.id,
    productId: product.id,
    facingsX: 4,
    facingsY: 1,
    facingsZ: 1,
  })

  const published = await publishPlanogramVersion(prisma, orgId, {
    planogramId,
    versionId,
    expectedRevision: await revision(versionId),
    target: { type: "STORES", storeIds: [storeId] },
    dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  })
  taskId = published.taskIds[0]!
  // Свежая задача: назначена мобильному сотруднику и переведена в IN_PROGRESS
  // (как ensureFreshProofTask в seed-demo).
  await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId: mobileUserId, status: "IN_PROGRESS" },
  })
})

afterAll(async () => {
  await prisma.outboxOperation.deleteMany({ where: { device: { user: { organizationId: orgId } } } })
  await prisma.syncConflict.deleteMany({ where: { device: { user: { organizationId: orgId } } } })
  await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: orgId } } })
  await prisma.photoSubmission.deleteMany({ where: { organizationId: orgId } })
  await prisma.captureTemplate.deleteMany({ where: { organizationId: orgId } })
  await prisma.task.deleteMany({ where: { organizationId: orgId } })
  await prisma.planogramPlacement.deleteMany({
    where: { planogramVersion: { planogram: { organizationId: orgId } } },
  })
  await prisma.planogram.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("mobile photo-proof green flow", () => {
  test("pull отдаёт свежую IN_PROGRESS задачу с captureTemplate и planogram bundle", async () => {
    const pulled = await pullChanges(prisma, orgId, mobileUserId, {})
    const task = pulled.tasks.find((t) => t.id === taskId)

    expect(task).toBeDefined()
    expect(task?.status).toBe("IN_PROGRESS")
    expect(task?.planogramVersionId).toBe(versionId)
    // captureTemplate резолвится по типу оборудования (rack) и проходит контракт.
    expect(task?.captureTemplate).not.toBeNull()
    expect(task?.captureTemplate?.equipmentKind).toBe("rack")
    expect(task?.captureTemplate?.scenarioId).toMatch(/^capture-template:/)
    expect(task?.captureTemplate?.version).toBeGreaterThanOrEqual(1)
    // steps едут как raw JSON (валидация контрактом — на границе pull route).
    expect(Array.isArray(task?.captureTemplate?.steps)).toBe(true)
    expect((task?.captureTemplate?.steps as unknown[]).length).toBe(RACK_STEPS.length)
    // planogram bundle immutable-версии присутствует для назначенной задачи.
    expect(pulled.planogramBundles.some((b) => b.versionId === versionId)).toBe(true)
  })

  test("photo.submit из IN_PROGRESS -> applied, задача PHOTO_SUBMITTED, повтор идемпотентен", async () => {
    const clientPhotoId = "proof-photo-0001"
    // Файл уже загружен multipart-запросом до photo.submit (как в клиенте).
    await prisma.photoSubmission.create({
      data: {
        organizationId: orgId,
        storeId,
        taskId,
        userId: mobileUserId,
        url: `photos/${orgId}/${taskId}/${clientPhotoId}.jpg`,
        clientPhotoId,
        takenAt: new Date(),
      },
    })

    const ops = [
      {
        clientOpId: "op-proof-photo-0001",
        kind: "photo.submit" as const,
        payload: { clientPhotoId, taskId },
      },
    ]
    const first = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, ops)
    const replay = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, ops)

    // Зелёный flow: applied, НЕ conflict/rejected.
    expect(first).toEqual([{ clientOpId: "op-proof-photo-0001", status: "applied" }])
    expect(replay).toEqual(first)
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true } }),
    ).resolves.toEqual({ status: "PHOTO_SUBMITTED" })
    // Ровно одна photo_submission на clientPhotoId.
    await expect(
      prisma.photoSubmission.count({ where: { organizationId: orgId, clientPhotoId } }),
    ).resolves.toBe(1)
    // Никаких зафиксированных конфликтов.
    await expect(
      prisma.syncConflict.count({ where: { device: { user: { organizationId: orgId } } } }),
    ).resolves.toBe(0)
  })

  test("повторный photo.submit тем же фото после PHOTO_SUBMITTED -> already_applied, не conflict", async () => {
    // Другой clientOpId (новый идемпотентный ключ после восстановления outbox),
    // задача уже PHOTO_SUBMITTED: сервер отвечает already_applied, не conflict.
    const result = await pushOperations(prisma, orgId, mobileUserId, mobileDeviceId, [
      {
        clientOpId: "op-proof-photo-0002",
        kind: "photo.submit" as const,
        payload: { clientPhotoId: "proof-photo-0001", taskId },
      },
    ])
    expect(result[0]?.status).toBe("already_applied")
  })
})
