import type { PrismaClient, TaskStatus } from "@prisma/client"
import { shelfSpaceForShelf, validatePlacementOnShelf } from "@leadshelf/core"
import { emitProductEvent } from "./alerts.ts"
import { PlanogramRepoError } from "./planogram.ts"

// Публикация: DRAFT -> PUBLISHED (immutable snapshot), заморозка геометрии
// оборудования, assignment на формат ИЛИ явный список точек, задача на
// каждую разрешенную точку. Дизайн: docs/17. DB-триггеры дублируют
// инварианты второй линией обороны.

export type PublishTarget =
  | { type: "FORMAT"; formatId: string }
  | { type: "STORES"; storeIds: string[] }

export async function publishPlanogramVersion(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    planogramId: string
    versionId: string
    expectedRevision: string
    target: PublishTarget
    activeFrom?: Date
    activeTo?: Date | null
    dueAt?: Date | null
    publishedById?: string
    changeNote?: string
  },
) {
  const version = await prisma.planogramVersion.findFirst({
    where: {
      id: input.versionId,
      planogramId: input.planogramId,
      planogram: { organizationId },
    },
    include: {
      planogram: { select: { name: true } },
      equipment: { include: { equipmentVersion: { include: { shelves: true } } } },
      placements: true,
    },
  })
  if (!version) throw new PlanogramRepoError("not_found")
  if (version.state !== "DRAFT") {
    throw new PlanogramRepoError("invalid_state", "публиковать можно только DRAFT")
  }
  if (version.updatedAt.getTime() !== new Date(input.expectedRevision).getTime()) {
    throw new PlanogramRepoError("version_conflict", "draft изменен параллельно")
  }
  if (version.placements.length === 0) {
    throw new PlanogramRepoError("invalid_state", "пустая планограмма не публикуется")
  }
  const eq = version.equipment[0]
  if (!eq) throw new PlanogramRepoError("invalid_state", "нет оборудования")

  // Стоп stale geometry: полки могли измениться после размещения —
  // ревалидируем ВСЕ placements против ТЕКУЩЕЙ геометрии (снапшот-габариты).
  const geometry = {
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
  }
  const candidates = version.placements.map((p) => ({
    id: p.id,
    shelfId: p.shelfId ?? "",
    xMm: p.xMm,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    depthMm: p.depthMm,
    facingsX: p.facingsX,
    facingsY: p.facingsY,
    facingsZ: p.facingsZ,
  }))
  const staleIssues: string[] = []
  for (const c of candidates) {
    const shelf = shelfSpaceForShelf(geometry, c.shelfId)
    if (!shelf) {
      staleIssues.push(`полка размещения ${c.id} удалена из оборудования`)
      continue
    }
    const verdict = validatePlacementOnShelf({ shelf, candidate: c, existing: candidates })
    if (!verdict.ok) staleIssues.push(verdict.message)
  }
  if (staleIssues.length > 0) {
    throw new PlanogramRepoError(
      "placement_rejected",
      "геометрия оборудования изменилась после размещения — исправьте draft",
      { code: "stale_geometry", issues: staleIssues },
    )
  }

  // Разрешение целевых точек
  let storeIds: string[]
  if (input.target.type === "FORMAT") {
    const stores = await prisma.store.findMany({
      where: { organizationId, formatId: input.target.formatId, isActive: true },
      select: { id: true },
    })
    storeIds = stores.map((s) => s.id)
    if (storeIds.length === 0) {
      throw new PlanogramRepoError("invalid_state", "в формате нет активных точек")
    }
  } else {
    const unique = [...new Set(input.target.storeIds)]
    if (unique.length !== input.target.storeIds.length) {
      throw new PlanogramRepoError("invalid_state", "дубликаты точек в списке")
    }
    const stores = await prisma.store.findMany({
      where: { organizationId, id: { in: unique }, isActive: true },
      select: { id: true },
    })
    if (stores.length !== unique.length) {
      throw new PlanogramRepoError("not_found", "часть точек не найдена или неактивна")
    }
    storeIds = unique
  }

  const activeFrom = input.activeFrom ?? new Date()
  const activeTo = input.activeTo ?? null
  if (activeTo && activeTo <= activeFrom) {
    throw new PlanogramRepoError("invalid_state", "activeTo раньше activeFrom")
  }

  // Пересечение с активными assignment-ами ЭТОЙ планограммы на те же точки
  const existingAssignments = await prisma.planogramAssignment.findMany({
    where: {
      planogramVersion: { planogramId: input.planogramId },
      OR: [{ activeTo: null }, { activeTo: { gt: activeFrom } }],
      ...(activeTo ? { activeFrom: { lt: activeTo } } : {}),
    },
    select: { storeId: true, formatId: true },
  })
  if (existingAssignments.length > 0) {
    const occupied = new Set<string>()
    for (const a of existingAssignments) {
      if (a.storeId) occupied.add(a.storeId)
      if (a.formatId) {
        const formatStores = await prisma.store.findMany({
          where: { organizationId, formatId: a.formatId },
          select: { id: true },
        })
        for (const s of formatStores) occupied.add(s.id)
      }
    }
    const clash = storeIds.filter((id) => occupied.has(id))
    if (clash.length > 0) {
      throw new PlanogramRepoError(
        "invalid_state",
        `на ${clash.length} точек уже действует активное назначение этой планограммы`,
      )
    }
  }

  return prisma.$transaction(async (tx) => {
    // атомарный переход DRAFT->PUBLISHED (двойной publish -> count 0 -> 409)
    const updated = await tx.planogramVersion.updateMany({
      where: { id: version.id, state: "DRAFT" },
      data: {
        state: "PUBLISHED",
        publishedAt: new Date(),
        publishedById: input.publishedById ?? null,
        changeNote: input.changeNote ?? null,
      },
    })
    if (updated.count === 0) {
      throw new PlanogramRepoError("version_conflict", "версия уже опубликована")
    }

    await tx.equipmentVersion.update({
      where: { id: eq.equipmentVersionId },
      data: { isFrozen: true },
    })

    const assignmentIds: string[] = []
    const taskIds: string[] = []
    if (input.target.type === "FORMAT") {
      const assignment = await tx.planogramAssignment.create({
        data: {
          planogramVersionId: version.id,
          formatId: input.target.formatId,
          activeFrom,
          activeTo,
        },
      })
      assignmentIds.push(assignment.id)
      for (const storeId of storeIds) {
        const task = await tx.task.create({
          data: {
            organizationId,
            storeId,
            planogramVersionId: version.id,
            assignmentId: assignment.id,
            title: version.planogram.name,
            status: "NEW",
            dueAt: input.dueAt ?? null,
          },
        })
        taskIds.push(task.id)
        await tx.taskStatusHistory.create({
          data: { taskId: task.id, fromStatus: null, toStatus: "NEW", byUserId: input.publishedById },
        })
      }
    } else {
      for (const storeId of storeIds) {
        const assignment = await tx.planogramAssignment.create({
          data: { planogramVersionId: version.id, storeId, activeFrom, activeTo },
        })
        assignmentIds.push(assignment.id)
        const task = await tx.task.create({
          data: {
            organizationId,
            storeId,
            planogramVersionId: version.id,
            assignmentId: assignment.id,
            title: version.planogram.name,
            status: "NEW",
            dueAt: input.dueAt ?? null,
          },
        })
        taskIds.push(task.id)
        await tx.taskStatusHistory.create({
          data: { taskId: task.id, fromStatus: null, toStatus: "NEW", byUserId: input.publishedById },
        })
      }
    }

    return {
      versionId: version.id,
      assignmentIds,
      taskIds,
      resolvedStoreCount: storeIds.length,
    }
  })
}

/** Продолжение работы после publish: клон в новую DRAFT-версию. */
export async function createNextDraft(
  prisma: PrismaClient,
  organizationId: string,
  input: { planogramId: string; sourceVersionId: string; authorId?: string },
) {
  const source = await prisma.planogramVersion.findFirst({
    where: {
      id: input.sourceVersionId,
      planogramId: input.planogramId,
      planogram: { organizationId },
    },
    include: { equipment: true, zones: true, placements: true },
  })
  if (!source) throw new PlanogramRepoError("not_found")
  if (source.state !== "PUBLISHED") {
    throw new PlanogramRepoError("invalid_state", "next draft создается из PUBLISHED")
  }

  const existingDraft = await prisma.planogramVersion.findFirst({
    where: { planogramId: input.planogramId, state: "DRAFT" },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true },
  })
  if (existingDraft) {
    return { versionId: existingDraft.id, versionNumber: existingDraft.versionNumber, created: false }
  }

  const latest = await prisma.planogramVersion.findFirst({
    where: { planogramId: input.planogramId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  })

  return prisma.$transaction(async (tx) => {
    const draft = await tx.planogramVersion.create({
      data: {
        planogramId: input.planogramId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        state: "DRAFT",
        authorId: input.authorId ?? null,
      },
    })
    const equipmentIdMap = new Map<string, string>()
    for (const eq of source.equipment) {
      const cloned = await tx.planogramEquipment.create({
        data: {
          planogramVersionId: draft.id,
          equipmentVersionId: eq.equipmentVersionId,
          label: eq.label,
          sortOrder: eq.sortOrder,
        },
      })
      equipmentIdMap.set(eq.id, cloned.id)
    }
    const zoneIdMap = new Map<string, string>()
    for (const z of source.zones) {
      const cloned = await tx.planogramZone.create({
        data: {
          planogramVersionId: draft.id,
          planogramEquipmentId: equipmentIdMap.get(z.planogramEquipmentId)!,
          name: z.name,
          color: z.color,
          xMm: z.xMm,
          yMm: z.yMm,
          widthMm: z.widthMm,
          heightMm: z.heightMm,
        },
      })
      zoneIdMap.set(z.id, cloned.id)
    }
    if (source.placements.length > 0) {
      await tx.planogramPlacement.createMany({
        data: source.placements.map((p) => ({
          planogramVersionId: draft.id,
          planogramEquipmentId: equipmentIdMap.get(p.planogramEquipmentId)!,
          shelfId: p.shelfId,
          zoneId: p.zoneId ? (zoneIdMap.get(p.zoneId) ?? null) : null,
          productId: p.productId,
          xMm: p.xMm,
          yMm: p.yMm,
          zMm: p.zMm,
          widthMm: p.widthMm,
          heightMm: p.heightMm,
          depthMm: p.depthMm,
          facingsX: p.facingsX,
          facingsY: p.facingsY,
          facingsZ: p.facingsZ,
          rotationX: p.rotationX,
          rotationY: p.rotationY,
          rotationZ: p.rotationZ,
          stackMode: p.stackMode,
          sortOrder: p.sortOrder,
        })),
      })
    }
    return { versionId: draft.id, versionNumber: draft.versionNumber, created: true }
  })
}

// FSM статусов задач (docs/17 e): терминальные не меняются в этом срезе.
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  NEW: ["IN_PROGRESS", "EXPIRED", "EMPTY"],
  IN_PROGRESS: ["PHOTO_SUBMITTED", "EXPIRED", "EMPTY"],
  PHOTO_SUBMITTED: ["COMPLETED", "EXPIRED"],
  COMPLETED: [],
  EXPIRED: [],
  EMPTY: [],
}

export async function transitionTaskStatus(
  prisma: PrismaClient,
  organizationId: string,
  input: { taskId: string; expectedStatus: TaskStatus; toStatus: TaskStatus; byUserId?: string },
) {
  const task = await prisma.task.findFirst({
    where: { id: input.taskId, organizationId },
    select: { id: true, status: true, title: true, storeId: true },
  })
  if (!task) throw new PlanogramRepoError("not_found")
  if (task.status !== input.expectedStatus) {
    throw new PlanogramRepoError("version_conflict", `статус уже ${task.status}`)
  }
  if (!TASK_TRANSITIONS[task.status].includes(input.toStatus)) {
    throw new PlanogramRepoError(
      "invalid_state",
      `переход ${task.status} -> ${input.toStatus} запрещен`,
    )
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: { id: task.id, status: input.expectedStatus },
      data: {
        status: input.toStatus,
        completedAt: input.toStatus === "COMPLETED" ? new Date() : null,
      },
    })
    if (updated.count === 0) {
      throw new PlanogramRepoError("version_conflict", "статус изменен параллельно")
    }
    await tx.taskStatusHistory.create({
      data: {
        taskId: task.id,
        fromStatus: input.expectedStatus,
        toStatus: input.toStatus,
        byUserId: input.byUserId ?? null,
      },
    })
    return { taskId: task.id, status: input.toStatus }
  })
}

const SLA_OPEN_STATUSES: TaskStatus[] = ["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"]

export async function expireOverdueTasks(
  prisma: PrismaClient,
  organizationId: string,
  input: { now?: Date; limit?: number; byUserId?: string } = {},
) {
  const now = input.now ?? new Date()
  const limit = input.limit ?? 500
  const candidates = await prisma.task.findMany({
    where: {
      organizationId,
      dueAt: { lt: now },
      status: { in: SLA_OPEN_STATUSES },
    },
    select: { id: true, status: true, title: true, storeId: true },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: limit,
  })

  const expired: Array<{ taskId: string; fromStatus: TaskStatus; title: string; storeId: string }> = []
  await prisma.$transaction(async (tx) => {
    for (const task of candidates) {
      const updated = await tx.task.updateMany({
        where: {
          id: task.id,
          organizationId,
          status: task.status,
          dueAt: { lt: now },
        },
        data: { status: "EXPIRED" },
      })
      if (updated.count !== 1) continue
      await tx.taskStatusHistory.create({
        data: {
          taskId: task.id,
          fromStatus: task.status,
          toStatus: "EXPIRED",
          byUserId: input.byUserId ?? null,
        },
      })
      expired.push({ taskId: task.id, fromStatus: task.status, title: task.title, storeId: task.storeId })
    }
  })

  await Promise.all(
    expired.map((task) =>
      emitProductEvent(prisma, organizationId, {
        kind: "task.overdue",
        severity: "warning",
        storeId: task.storeId,
        entityType: "task",
        entityId: task.taskId,
        dedupeKey: `task.overdue:${task.taskId}`,
        payload: { title: task.title, fromStatus: task.fromStatus },
        occurredAt: now,
      }),
    ),
  )

  return {
    expiredCount: expired.length,
    taskIds: expired.map((task) => task.taskId),
    hasMore: candidates.length === limit,
  }
}

export async function getTaskSlaSummary(
  prisma: PrismaClient,
  organizationId: string,
  input: { now?: Date } = {},
) {
  const now = input.now ?? new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay)
  endOfDay.setDate(endOfDay.getDate() + 1)

  const [open, dueToday, expired, completed, unassignedOpen] = await Promise.all([
    prisma.task.count({ where: { organizationId, status: { in: SLA_OPEN_STATUSES } } }),
    prisma.task.count({
      where: {
        organizationId,
        status: { in: SLA_OPEN_STATUSES },
        dueAt: { gte: startOfDay, lt: endOfDay },
      },
    }),
    prisma.task.count({ where: { organizationId, status: "EXPIRED" } }),
    prisma.task.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.task.count({
      where: { organizationId, status: { in: SLA_OPEN_STATUSES }, assigneeId: null },
    }),
  ])

  return { open, dueToday, expired, completed, unassignedOpen }
}
