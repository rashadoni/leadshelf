import type { PrismaClient } from "@prisma/client"
import {
  nextFreeXMm,
  shelfSpaceForShelf,
  validatePlacementOnShelf,
  type EquipmentGeometryMm,
  type PlacementCandidateMm,
} from "@leadshelf/core"

// Parent-path репозиторий планограмм. Инварианты графа (schema comments):
// полка принадлежит equipmentVersion того же planogramEquipment; placement
// хранит СНАПШОТ габаритов товара; правки только в DRAFT; optimistic lock
// через PlanogramVersion.updatedAt (revision token).

export class PlanogramRepoError extends Error {
  constructor(
    public code:
      | "not_found"
      | "version_conflict"
      | "invalid_state"
      | "invalid_shelf"
      | "missing_product_dimensions"
      | "placement_rejected",
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code)
  }
}

export async function createPlanogramFromTemplate(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    name: string
    description?: string
    categoryId?: string
    equipmentTemplateId: string
    authorId?: string
  },
) {
  const template = await prisma.equipmentTemplate.findFirst({
    where: { id: input.equipmentTemplateId, organizationId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  })
  const equipmentVersion = template?.versions[0]
  if (!template || !equipmentVersion) throw new PlanogramRepoError("not_found", "template not found")

  return prisma.$transaction(async (tx) => {
    const planogram = await tx.planogram.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
      },
    })
    const version = await tx.planogramVersion.create({
      data: {
        planogramId: planogram.id,
        versionNumber: 1,
        state: "DRAFT",
        authorId: input.authorId ?? null,
      },
    })
    await tx.planogramEquipment.create({
      data: {
        planogramVersionId: version.id,
        equipmentVersionId: equipmentVersion.id,
        sortOrder: 0,
      },
    })
    return { planogramId: planogram.id, versionId: version.id }
  })
}

/** Полный payload редактора одной версией. Владение — через Planogram.organizationId. */
export async function getPlanogramEditor(
  prisma: PrismaClient,
  organizationId: string,
  planogramId: string,
  versionId: string,
) {
  const planogram = await prisma.planogram.findFirst({
    where: { id: planogramId, organizationId },
    select: { id: true, name: true },
  })
  if (!planogram) return null

  const version = await prisma.planogramVersion.findFirst({
    where: { id: versionId, planogramId },
    include: {
      equipment: {
        orderBy: { sortOrder: "asc" },
        include: {
          equipmentVersion: {
            include: {
              template: { select: { name: true } },
              shelves: { orderBy: { shelfIndex: "asc" } },
            },
          },
        },
      },
      zones: { orderBy: [{ name: "asc" }, { id: "asc" }] },
      placements: {
        orderBy: [{ shelfId: "asc" }, { xMm: "asc" }],
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              brand: { select: { name: true } },
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
  })
  if (!version) return null
  return { planogram, version }
}

interface PlacementGraph {
  version: { id: string; state: string; updatedAt: Date }
  equipment: EquipmentGeometryMm
  planogramEquipmentId: string
  existing: PlacementCandidateMm[]
}

async function loadPlacementGraph(
  prisma: PrismaClient,
  organizationId: string,
  planogramVersionId: string,
): Promise<PlacementGraph> {
  const version = await prisma.planogramVersion.findFirst({
    where: { id: planogramVersionId, planogram: { organizationId } },
    include: {
      equipment: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        include: { equipmentVersion: { include: { shelves: true } } },
      },
      placements: {
        select: {
          id: true,
          shelfId: true,
          xMm: true,
          widthMm: true,
          heightMm: true,
          depthMm: true,
          facingsX: true,
          facingsY: true,
          facingsZ: true,
        },
      },
    },
  })
  if (!version) throw new PlanogramRepoError("not_found")
  if (version.state !== "DRAFT") {
    throw new PlanogramRepoError("invalid_state", "редактировать можно только DRAFT-версию")
  }
  const eq = version.equipment[0]
  if (!eq) throw new PlanogramRepoError("not_found", "no equipment in version")

  return {
    version: { id: version.id, state: version.state, updatedAt: version.updatedAt },
    planogramEquipmentId: eq.id,
    equipment: {
      widthMm: eq.equipmentVersion.widthMm,
      heightMm: eq.equipmentVersion.heightMm,
      depthMm: eq.equipmentVersion.depthMm,
      shelves: eq.equipmentVersion.shelves.map((s) => ({
        id: s.id,
        shelfIndex: s.shelfIndex,
        yMm: s.yMm,
        thicknessMm: s.thicknessMm,
        depthMm: s.depthMm,
      })),
    },
    existing: version.placements.map((p) => ({
      id: p.id,
      shelfId: p.shelfId ?? "",
      xMm: p.xMm,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      depthMm: p.depthMm,
      facingsX: p.facingsX,
      facingsY: p.facingsY,
      facingsZ: p.facingsZ,
    })),
  }
}

function assertRevision(version: { updatedAt: Date }, expected: string): void {
  if (version.updatedAt.getTime() !== new Date(expected).getTime()) {
    throw new PlanogramRepoError("version_conflict", "draft изменен параллельно — обновите")
  }
}

async function bumpRevision(prisma: PrismaClient, versionId: string): Promise<Date> {
  const updated = await prisma.planogramVersion.update({
    where: { id: versionId },
    data: { updatedAt: new Date() },
    select: { updatedAt: true },
  })
  return updated.updatedAt
}

export async function addPlacement(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    planogramVersionId: string
    expectedRevision: string
    shelfId: string
    productId: string
    xMm?: number
    facingsX: number
    facingsY: number
    facingsZ: number
  },
) {
  const graph = await loadPlacementGraph(prisma, organizationId, input.planogramVersionId)
  assertRevision(graph.version, input.expectedRevision)

  const shelf = shelfSpaceForShelf(graph.equipment, input.shelfId)
  if (!shelf) throw new PlanogramRepoError("invalid_shelf", "полка не принадлежит оборудованию версии")

  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId },
    select: { id: true, widthMm: true, heightMm: true, depthMm: true },
  })
  if (!product) throw new PlanogramRepoError("not_found", "товар не найден")
  if (product.widthMm == null || product.heightMm == null || product.depthMm == null) {
    throw new PlanogramRepoError(
      "missing_product_dimensions",
      "у товара нет размеров — заполните в каталоге",
    )
  }

  // снапшот габаритов на момент размещения (товар может измениться позже)
  const dims = {
    widthMm: product.widthMm,
    heightMm: product.heightMm,
    depthMm: product.depthMm,
  }
  const width = dims.widthMm * input.facingsX
  const xMm =
    input.xMm ??
    nextFreeXMm({
      shelf,
      shelfId: input.shelfId,
      widthNeededMm: width,
      existing: graph.existing,
    })
  if (xMm == null) {
    throw new PlanogramRepoError(
      "placement_rejected",
      `нет свободных ${width}мм на полке`,
      { code: "outside_width" },
    )
  }

  const candidate: PlacementCandidateMm = {
    shelfId: input.shelfId,
    xMm,
    facingsX: input.facingsX,
    facingsY: input.facingsY,
    facingsZ: input.facingsZ,
    ...dims,
  }
  const verdict = validatePlacementOnShelf({ shelf, candidate, existing: graph.existing })
  if (!verdict.ok) {
    throw new PlanogramRepoError("placement_rejected", verdict.message, { code: verdict.code })
  }

  return prisma.$transaction(async (tx) => {
    const placement = await tx.planogramPlacement.create({
      data: {
        planogramVersionId: graph.version.id,
        planogramEquipmentId: graph.planogramEquipmentId,
        shelfId: input.shelfId,
        productId: product.id,
        xMm,
        yMm: shelf.surfaceYMm,
        zMm: 0,
        ...dims,
        facingsX: input.facingsX,
        facingsY: input.facingsY,
        facingsZ: input.facingsZ,
      },
    })
    const revision = await bumpRevision(tx as unknown as PrismaClient, graph.version.id)
    return { placementId: placement.id, xMm, revision: revision.toISOString() }
  })
}

export async function updatePlacement(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    placementId: string
    expectedRevision: string
    shelfId?: string
    xMm?: number
    facingsX?: number
    facingsY?: number
    facingsZ?: number
  },
) {
  const placement = await prisma.planogramPlacement.findFirst({
    where: { id: input.placementId, planogramVersion: { planogram: { organizationId } } },
  })
  if (!placement) throw new PlanogramRepoError("not_found")

  const graph = await loadPlacementGraph(prisma, organizationId, placement.planogramVersionId)
  assertRevision(graph.version, input.expectedRevision)

  const shelfId = input.shelfId ?? placement.shelfId
  if (!shelfId) throw new PlanogramRepoError("invalid_shelf")
  const shelf = shelfSpaceForShelf(graph.equipment, shelfId)
  if (!shelf) throw new PlanogramRepoError("invalid_shelf", "полка не принадлежит оборудованию версии")

  const candidate: PlacementCandidateMm = {
    id: placement.id,
    shelfId,
    xMm: input.xMm ?? placement.xMm,
    facingsX: input.facingsX ?? placement.facingsX,
    facingsY: input.facingsY ?? placement.facingsY,
    facingsZ: input.facingsZ ?? placement.facingsZ,
    widthMm: placement.widthMm, // снапшот, НЕ текущие габариты товара
    heightMm: placement.heightMm,
    depthMm: placement.depthMm,
  }
  const verdict = validatePlacementOnShelf({ shelf, candidate, existing: graph.existing })
  if (!verdict.ok) {
    throw new PlanogramRepoError("placement_rejected", verdict.message, { code: verdict.code })
  }

  return prisma.$transaction(async (tx) => {
    await tx.planogramPlacement.update({
      where: { id: placement.id },
      data: {
        shelfId,
        xMm: candidate.xMm,
        yMm: shelf.surfaceYMm,
        facingsX: candidate.facingsX,
        facingsY: candidate.facingsY,
        facingsZ: candidate.facingsZ,
      },
    })
    const revision = await bumpRevision(tx as unknown as PrismaClient, graph.version.id)
    return { revision: revision.toISOString() }
  })
}

export async function removePlacement(
  prisma: PrismaClient,
  organizationId: string,
  input: { placementId: string; expectedRevision: string },
) {
  const placement = await prisma.planogramPlacement.findFirst({
    where: { id: input.placementId, planogramVersion: { planogram: { organizationId } } },
    select: { id: true, planogramVersionId: true },
  })
  if (!placement) throw new PlanogramRepoError("not_found")

  const graph = await loadPlacementGraph(prisma, organizationId, placement.planogramVersionId)
  assertRevision(graph.version, input.expectedRevision)

  return prisma.$transaction(async (tx) => {
    await tx.planogramPlacement.delete({ where: { id: placement.id } })
    const revision = await bumpRevision(tx as unknown as PrismaClient, graph.version.id)
    return { revision: revision.toISOString() }
  })
}
