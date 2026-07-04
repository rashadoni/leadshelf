import type { PrismaClient } from "@prisma/client"

// Parent-path репозиторий оборудования: EquipmentVersion/Shelf не имеют
// organizationId, tenant client их не пишет. Владение проверяется через
// EquipmentTemplate.organizationId, гео-записи — одной транзакцией.
//
// Версионная семантика (docs/15): template = identity, version = geometry.
// Незамороженная последняя версия редактируется НА МЕСТЕ; frozen-версия
// клонируется в versionNumber+1 (publish планограммы заморозит ее в Phase 4).

export interface ShelfInput {
  shelfIndex: number
  yMm: number
  thicknessMm: number
  depthMm: number
  maxLoadKg?: number | null
}

export interface CellInput {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  depthMm: number
}

export interface HookInput {
  xMm: number
  yMm: number
  lengthMm: number
}

export interface GeometryInput {
  widthMm: number
  heightMm: number
  depthMm: number
}

export class EquipmentRepoError extends Error {
  constructor(
    public code: "not_found" | "version_conflict" | "not_latest",
    message?: string,
  ) {
    super(message ?? code)
  }
}

async function assertTemplateOwned(
  prisma: PrismaClient,
  organizationId: string,
  templateId: string,
): Promise<void> {
  const template = await prisma.equipmentTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { id: true },
  })
  if (!template) throw new EquipmentRepoError("not_found")
}

export async function createTemplateWithVersion(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    name: string
    typeId: string
    geometry: GeometryInput
    shelves: ShelfInput[]
    cells?: CellInput[]
    hooks?: HookInput[]
  },
) {
  // тип должен принадлежать тенанту
  const type = await prisma.equipmentType.findFirst({
    where: { id: input.typeId, organizationId },
    select: { id: true },
  })
  if (!type) throw new EquipmentRepoError("not_found", "equipment type not found")

  return prisma.$transaction(async (tx) => {
    const template = await tx.equipmentTemplate.create({
      data: { organizationId, typeId: input.typeId, name: input.name },
    })
    const version = await tx.equipmentVersion.create({
      data: { templateId: template.id, versionNumber: 1, ...input.geometry },
    })
    if (input.shelves.length > 0) {
      await tx.equipmentShelf.createMany({
        data: input.shelves.map((s) => ({ equipmentVersionId: version.id, ...s })),
      })
    }
    if (input.cells?.length) {
      await tx.equipmentCell.createMany({
        data: input.cells.map((cell) => ({ equipmentVersionId: version.id, ...cell })),
      })
    }
    if (input.hooks?.length) {
      await tx.equipmentHook.createMany({
        data: input.hooks.map((hook) => ({ equipmentVersionId: version.id, ...hook })),
      })
    }
    return { templateId: template.id, versionId: version.id, versionNumber: 1 }
  })
}

/**
 * Save-семантика формы: последняя версия незаморожена -> update на месте;
 * заморожена -> клон в новую draft-версию. expectedVersionNumber защищает
 * от конкурентного редактирования (optimistic lock).
 */
export async function saveVersion(
  prisma: PrismaClient,
  organizationId: string,
  templateId: string,
  input: {
    expectedVersionNumber: number
    geometry: GeometryInput
    shelves: ShelfInput[]
    cells?: CellInput[]
    hooks?: HookInput[]
  },
) {
  await assertTemplateOwned(prisma, organizationId, templateId)

  return prisma.$transaction(async (tx) => {
    const latest = await tx.equipmentVersion.findFirst({
      where: { templateId },
      orderBy: { versionNumber: "desc" },
    })
    if (!latest) throw new EquipmentRepoError("not_found", "no versions")
    if (latest.versionNumber !== input.expectedVersionNumber) {
      throw new EquipmentRepoError(
        "version_conflict",
        `expected v${input.expectedVersionNumber}, latest is v${latest.versionNumber}`,
      )
    }

    if (!latest.isFrozen) {
      // редактируем draft на месте: гео + полная замена полок
      await tx.equipmentVersion.update({
        where: { id: latest.id },
        data: input.geometry,
      })
      await tx.equipmentShelf.deleteMany({ where: { equipmentVersionId: latest.id } })
      await tx.equipmentCell.deleteMany({ where: { equipmentVersionId: latest.id } })
      await tx.equipmentHook.deleteMany({ where: { equipmentVersionId: latest.id } })
      if (input.shelves.length > 0) {
        await tx.equipmentShelf.createMany({
          data: input.shelves.map((s) => ({ equipmentVersionId: latest.id, ...s })),
        })
      }
      if (input.cells?.length) {
        await tx.equipmentCell.createMany({
          data: input.cells.map((cell) => ({ equipmentVersionId: latest.id, ...cell })),
        })
      }
      if (input.hooks?.length) {
        await tx.equipmentHook.createMany({
          data: input.hooks.map((hook) => ({ equipmentVersionId: latest.id, ...hook })),
        })
      }
      return { versionId: latest.id, versionNumber: latest.versionNumber, created: false }
    }

    // frozen -> новая draft-версия
    const next = await tx.equipmentVersion.create({
      data: { templateId, versionNumber: latest.versionNumber + 1, ...input.geometry },
    })
    if (input.shelves.length > 0) {
      await tx.equipmentShelf.createMany({
        data: input.shelves.map((s) => ({ equipmentVersionId: next.id, ...s })),
      })
    }
    if (input.cells?.length) {
      await tx.equipmentCell.createMany({
        data: input.cells.map((cell) => ({ equipmentVersionId: next.id, ...cell })),
      })
    }
    if (input.hooks?.length) {
      await tx.equipmentHook.createMany({
        data: input.hooks.map((hook) => ({ equipmentVersionId: next.id, ...hook })),
      })
    }
    return { versionId: next.id, versionNumber: next.versionNumber, created: true }
  })
}

export async function copyTemplate(
  prisma: PrismaClient,
  organizationId: string,
  templateId: string,
  input: { name?: string },
) {
  const source = await prisma.equipmentTemplate.findFirst({
    where: { id: templateId, organizationId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { shelves: true, cells: true, hooks: true },
      },
    },
  })
  if (!source) throw new EquipmentRepoError("not_found")
  const latest = source.versions[0]
  if (!latest) throw new EquipmentRepoError("not_found", "no versions")

  return prisma.$transaction(async (tx) => {
    const template = await tx.equipmentTemplate.create({
      data: {
        organizationId,
        typeId: source.typeId,
        name: input.name?.trim() || `${source.name} copy`,
      },
    })
    const version = await tx.equipmentVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        widthMm: latest.widthMm,
        heightMm: latest.heightMm,
        depthMm: latest.depthMm,
      },
    })
    await tx.equipmentShelf.createMany({
      data: latest.shelves.map((s) => ({
        equipmentVersionId: version.id,
        shelfIndex: s.shelfIndex,
        yMm: s.yMm,
        thicknessMm: s.thicknessMm,
        depthMm: s.depthMm,
        maxLoadKg: s.maxLoadKg,
      })),
    })
    if (latest.cells.length > 0) {
      await tx.equipmentCell.createMany({
        data: latest.cells.map((cell) => ({
          equipmentVersionId: version.id,
          xMm: cell.xMm,
          yMm: cell.yMm,
          widthMm: cell.widthMm,
          heightMm: cell.heightMm,
          depthMm: cell.depthMm,
        })),
      })
    }
    if (latest.hooks.length > 0) {
      await tx.equipmentHook.createMany({
        data: latest.hooks.map((hook) => ({
          equipmentVersionId: version.id,
          xMm: hook.xMm,
          yMm: hook.yMm,
          lengthMm: hook.lengthMm,
        })),
      })
    }
    return { templateId: template.id, versionId: version.id, versionNumber: 1 }
  })
}

export async function renameTemplate(
  prisma: PrismaClient,
  organizationId: string,
  templateId: string,
  data: { name?: string; typeId?: string },
) {
  await assertTemplateOwned(prisma, organizationId, templateId)
  if (data.typeId) {
    const type = await prisma.equipmentType.findFirst({
      where: { id: data.typeId, organizationId },
      select: { id: true },
    })
    if (!type) throw new EquipmentRepoError("not_found", "equipment type not found")
  }
  await prisma.equipmentTemplate.update({ where: { id: templateId }, data })
}
