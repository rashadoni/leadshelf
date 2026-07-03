import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import {
  createTemplateWithVersion,
  saveVersion,
  EquipmentRepoError,
} from "../repos/equipment.ts"

const prisma = createSystemClient("equipment-repo-test")
const slug = `test-equip-${Date.now()}`
let orgId: string
let typeId: string
let foreignOrgId: string

const GEOMETRY = { widthMm: 1200, heightMm: 1800, depthMm: 300 }
const SHELVES = [0, 1, 2, 3, 4].map((i) => ({
  shelfIndex: i,
  yMm: 50 + i * 350,
  thicknessMm: 20,
  depthMm: 300,
}))

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Equip Test", slug } })
  orgId = org.id
  const foreign = await prisma.organization.create({
    data: { name: "Foreign", slug: `${slug}-f` },
  })
  foreignOrgId = foreign.id
  const type = await prisma.equipmentType.create({
    data: { organizationId: orgId, name: "Rəf", kind: "rack" },
  })
  typeId = type.id
})

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.organization.delete({ where: { id: foreignOrgId } })
  await prisma.$disconnect()
})

describe("equipment repo", () => {
  test("DoD: стеллаж 1200x1800x300 с 5 полками сохраняется в библиотеку", async () => {
    const created = await createTemplateWithVersion(prisma, orgId, {
      name: "Стеллаж стандартный",
      typeId,
      geometry: GEOMETRY,
      shelves: SHELVES,
    })
    expect(created.versionNumber).toBe(1)

    const template = await prisma.equipmentTemplate.findFirst({
      where: { id: created.templateId },
      include: { versions: { include: { shelves: true } } },
    })
    expect(template?.versions[0]?.shelves).toHaveLength(5)
    expect(template?.versions[0]?.widthMm).toBe(1200)
  })

  test("draft редактируется НА МЕСТЕ, без новой версии", async () => {
    const created = await createTemplateWithVersion(prisma, orgId, {
      name: "Витрина",
      typeId,
      geometry: GEOMETRY,
      shelves: SHELVES,
    })
    const saved = await saveVersion(prisma, orgId, created.templateId, {
      expectedVersionNumber: 1,
      geometry: { ...GEOMETRY, heightMm: 2000 },
      shelves: SHELVES.slice(0, 3),
    })
    expect(saved.created).toBe(false)
    expect(saved.versionNumber).toBe(1)

    const versions = await prisma.equipmentVersion.findMany({
      where: { templateId: created.templateId },
      include: { shelves: true },
    })
    expect(versions).toHaveLength(1)
    expect(versions[0]!.heightMm).toBe(2000)
    expect(versions[0]!.shelves).toHaveLength(3)
  })

  test("frozen-версия клонируется в новую draft; геометрия frozen неизменна", async () => {
    const created = await createTemplateWithVersion(prisma, orgId, {
      name: "Паллета",
      typeId,
      geometry: GEOMETRY,
      shelves: SHELVES,
    })
    await prisma.equipmentVersion.update({
      where: { id: created.versionId },
      data: { isFrozen: true }, // Phase 4 publish сделает это по-настоящему
    })

    const saved = await saveVersion(prisma, orgId, created.templateId, {
      expectedVersionNumber: 1,
      geometry: { ...GEOMETRY, widthMm: 900 },
      shelves: SHELVES.slice(0, 2),
    })
    expect(saved.created).toBe(true)
    expect(saved.versionNumber).toBe(2)

    const v1 = await prisma.equipmentVersion.findUnique({
      where: { id: created.versionId },
      include: { shelves: true },
    })
    expect(v1!.widthMm).toBe(1200) // frozen не тронут
    expect(v1!.shelves).toHaveLength(5)
  })

  test("optimistic lock: неверный expectedVersionNumber -> version_conflict", async () => {
    const created = await createTemplateWithVersion(prisma, orgId, {
      name: "Стол",
      typeId,
      geometry: GEOMETRY,
      shelves: [],
    })
    await expect(
      saveVersion(prisma, orgId, created.templateId, {
        expectedVersionNumber: 99,
        geometry: GEOMETRY,
        shelves: [],
      }),
    ).rejects.toMatchObject({ code: "version_conflict" })
    expect(created).toBeTruthy()
  })

  test("чужой тенант не видит шаблон (not_found)", async () => {
    const created = await createTemplateWithVersion(prisma, orgId, {
      name: "Стенд",
      typeId,
      geometry: GEOMETRY,
      shelves: [],
    })
    await expect(
      saveVersion(prisma, foreignOrgId, created.templateId, {
        expectedVersionNumber: 1,
        geometry: GEOMETRY,
        shelves: [],
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })
})
