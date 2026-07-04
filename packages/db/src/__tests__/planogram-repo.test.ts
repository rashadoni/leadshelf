import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import { createTemplateWithVersion } from "../repos/equipment.ts"
import {
  addPlacement,
  createPlanogramFromTemplate,
  getPlanogramEditor,
  removePlacement,
  updatePlacement,
} from "../repos/planogram.ts"

const prisma = createSystemClient("planogram-repo-test")
const slug = `test-plano-${Date.now()}`
let orgId: string
let templateId: string
let productId: string
let noDimsProductId: string
let planogramId: string
let versionId: string
let revision: string

async function currentRevision(): Promise<string> {
  const v = await prisma.planogramVersion.findUnique({
    where: { id: versionId },
    select: { updatedAt: true },
  })
  return v!.updatedAt.toISOString()
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Plano Test", slug } })
  orgId = org.id
  const type = await prisma.equipmentType.create({
    data: { organizationId: orgId, name: "Rəf", kind: "rack" },
  })
  const tpl = await createTemplateWithVersion(prisma, orgId, {
    name: "Стеллаж",
    typeId: type.id,
    geometry: { widthMm: 1200, heightMm: 1800, depthMm: 300 },
    shelves: [0, 1, 2, 3, 4].map((i) => ({
      shelfIndex: i,
      yMm: 50 + i * 350,
      thicknessMm: 20,
      depthMm: 300,
    })),
  })
  templateId = tpl.templateId
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
  productId = product.id
  const noDims = await prisma.product.create({
    data: { organizationId: orgId, sku: "P-NODIMS", name: "Без размеров" },
  })
  noDimsProductId = noDims.id
})

afterAll(async () => {
  // порядок: placements (Restrict на product) -> planograms (их equipment-
  // links держат EquipmentVersion через Restrict) -> org-каскад
  await prisma.planogramPlacement.deleteMany({
    where: { planogramVersion: { planogram: { organizationId: orgId } } },
  })
  await prisma.planogram.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("planogram repo", () => {
  test("создание планограммы из шаблона: v1 DRAFT + equipment version link", async () => {
    const created = await createPlanogramFromTemplate(prisma, orgId, {
      name: "Полка OTC",
      equipmentTemplateId: templateId,
    })
    planogramId = created.planogramId
    versionId = created.versionId
    revision = await currentRevision()

    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    expect(editor?.version.state).toBe("DRAFT")
    expect(editor?.version.equipment[0]?.equipmentVersion.shelves).toHaveLength(5)
  })

  test("addPlacement: авто-X, снапшот габаритов, второй встает после первого", async () => {
    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    const shelfId = editor!.version.equipment[0]!.equipmentVersion.shelves[0]!.id

    const p1 = await addPlacement(prisma, orgId, {
      planogramVersionId: versionId,
      expectedRevision: revision,
      shelfId,
      productId,
      facingsX: 4,
      facingsY: 1,
      facingsZ: 1,
    })
    expect(p1.xMm).toBe(0)
    revision = p1.revision

    const p2 = await addPlacement(prisma, orgId, {
      planogramVersionId: versionId,
      expectedRevision: revision,
      shelfId,
      productId,
      facingsX: 2,
      facingsY: 1,
      facingsZ: 1,
    })
    expect(p2.xMm).toBe(300) // после 4x75
    revision = p2.revision

    const stored = await prisma.planogramPlacement.findUnique({ where: { id: p1.placementId } })
    expect(stored?.widthMm).toBe(75) // снапшот
    expect(stored?.yMm).toBe(70) // поверх полки (50+20)
  })

  test("физика: глубина не лезет; товар без размеров блокируется", async () => {
    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    const shelfId = editor!.version.equipment[0]!.equipmentVersion.shelves[1]!.id

    await expect(
      addPlacement(prisma, orgId, {
        planogramVersionId: versionId,
        expectedRevision: revision,
        shelfId,
        productId,
        facingsX: 1,
        facingsY: 1,
        facingsZ: 6, // 360мм > 300
      }),
    ).rejects.toMatchObject({ code: "placement_rejected", details: { code: "outside_depth" } })

    await expect(
      addPlacement(prisma, orgId, {
        planogramVersionId: versionId,
        expectedRevision: revision,
        shelfId,
        productId: noDimsProductId,
        facingsX: 1,
        facingsY: 1,
        facingsZ: 1,
      }),
    ).rejects.toMatchObject({ code: "missing_product_dimensions" })
  })

  test("optimistic lock: протухшая ревизия -> version_conflict", async () => {
    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    const shelfId = editor!.version.equipment[0]!.equipmentVersion.shelves[2]!.id
    await expect(
      addPlacement(prisma, orgId, {
        planogramVersionId: versionId,
        expectedRevision: new Date(0).toISOString(),
        shelfId,
        productId,
        facingsX: 1,
        facingsY: 1,
        facingsZ: 1,
      }),
    ).rejects.toMatchObject({ code: "version_conflict" })
  })

  test("update двигает и ревалидирует; remove удаляет", async () => {
    const placements = await prisma.planogramPlacement.findMany({
      where: { planogramVersionId: versionId },
      orderBy: { xMm: "asc" },
    })
    const first = placements[0]!

    // сдвиг вправо на свободное место
    const moved = await updatePlacement(prisma, orgId, {
      placementId: first.id,
      expectedRevision: revision,
      xMm: 600,
    })
    revision = moved.revision

    // коллизия при попытке налезть на второго (второй на 300-450)
    await expect(
      updatePlacement(prisma, orgId, {
        placementId: first.id,
        expectedRevision: revision,
        xMm: 350,
      }),
    ).rejects.toMatchObject({ code: "placement_rejected", details: { code: "collision" } })

    const removed = await removePlacement(prisma, orgId, {
      placementId: first.id,
      expectedRevision: revision,
    })
    revision = removed.revision
    expect(
      await prisma.planogramPlacement.count({ where: { planogramVersionId: versionId } }),
    ).toBe(1)
  })

  test("rotation и stackMode сохраняются и участвуют в физической валидации", async () => {
    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    const shelfId = editor!.version.equipment[0]!.equipmentVersion.shelves[3]!.id

    const rotated = await addPlacement(prisma, orgId, {
      planogramVersionId: versionId,
      expectedRevision: revision,
      shelfId,
      productId,
      facingsX: 2,
      facingsY: 1,
      facingsZ: 1,
      rotationY: 90,
      stackMode: "LYING",
    })
    expect(rotated.xMm).toBe(0)
    revision = rotated.revision

    const second = await addPlacement(prisma, orgId, {
      planogramVersionId: versionId,
      expectedRevision: revision,
      shelfId,
      productId,
      facingsX: 1,
      facingsY: 1,
      facingsZ: 1,
    })
    expect(second.xMm).toBe(120) // rotationY swaps width/depth: 2 x 60mm, not 2 x 75mm
    revision = second.revision

    await expect(
      updatePlacement(prisma, orgId, {
        placementId: rotated.placementId,
        expectedRevision: revision,
        facingsY: 6,
        stackMode: "ON_TOP",
      }),
    ).rejects.toMatchObject({ code: "placement_rejected", details: { code: "outside_height" } })

    const stored = await prisma.planogramPlacement.findUniqueOrThrow({ where: { id: rotated.placementId } })
    expect(stored.rotationY).toBe(90)
    expect(stored.stackMode).toBe("LYING")

    await expect(
      updatePlacement(prisma, orgId, {
        placementId: rotated.placementId,
        expectedRevision: revision,
        rotationY: 45,
      }),
    ).rejects.toMatchObject({ code: "placement_rejected", details: { code: "invalid_rotation" } })
  })

  test("не-DRAFT версия закрыта для правок", async () => {
    await prisma.planogramVersion.update({
      where: { id: versionId },
      data: { state: "PUBLISHED" },
    })
    const editor = await getPlanogramEditor(prisma, orgId, planogramId, versionId)
    const shelfId = editor!.version.equipment[0]!.equipmentVersion.shelves[0]!.id
    await expect(
      addPlacement(prisma, orgId, {
        planogramVersionId: versionId,
        expectedRevision: revision,
        shelfId,
        productId,
        facingsX: 1,
        facingsY: 1,
        facingsZ: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" })
  })
})
