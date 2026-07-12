import type { PrismaClient } from "@prisma/client"

// Петля пересъемки шага (docs/23 web review backlog). Все функции берут
// явный organizationId и фильтруют по нему — tenant boundary как в
// mobile-sync (workerDb — системный клиент без авто-скоупа).

export interface RequestCaptureRetakeInput {
  taskId: string
  stepId: string
  stepKind?: string | null
  note?: string | null
  requestedById: string
  reviewId?: string | null
}

export class CaptureRepoError extends Error {
  constructor(public code: "task_not_found") {
    super(code)
  }
}

/**
 * Офис просит переснять шаг. Один активный запрос на (org, task, step):
 * повторный запрос переоткрывает существующий и двигает requestedAt.
 */
export async function requestCaptureRetake(
  prisma: PrismaClient,
  organizationId: string,
  input: RequestCaptureRetakeInput,
) {
  const task = await prisma.task.findFirst({
    where: { id: input.taskId, organizationId },
    select: { id: true },
  })
  if (!task) throw new CaptureRepoError("task_not_found")
  const now = new Date()
  const note = input.note?.trim() || null
  // Бампаем task.updatedAt в той же транзакции: pull курсорный, и без
  // изменения задачи запрос пересъемки не переотдался бы на устройство
  // (docs/26 P0). Один $transaction — либо оба, либо ничего.
  const retakeOperation = prisma.captureRetakeRequest.upsert({
      where: {
        organizationId_taskId_stepId: {
          organizationId,
          taskId: input.taskId,
          stepId: input.stepId,
        },
      },
      create: {
        organizationId,
        taskId: input.taskId,
        stepId: input.stepId,
        stepKind: input.stepKind ?? null,
        note,
        requestedById: input.requestedById,
        requestedAt: now,
      },
      update: {
        stepKind: input.stepKind ?? null,
        note,
        requestedById: input.requestedById,
        requestedAt: now,
        resolvedAt: null,
      },
      select: { id: true, stepId: true, requestedAt: true },
    })
  const taskOperation = prisma.task.update({ where: { id: input.taskId }, data: { updatedAt: now } })
  if (input.reviewId) {
    const [request] = await prisma.$transaction([
      retakeOperation,
      taskOperation,
      prisma.humanReview.updateMany({
        where: {
          id: input.reviewId,
          organizationId,
          taskId: input.taskId,
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          reviewedById: input.requestedById,
          reviewedAt: now,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId,
          userId: input.requestedById,
          action: "shelf_analysis.retake_requested",
          entityType: "HumanReview",
          entityId: input.reviewId,
          payload: { taskId: input.taskId, stepId: input.stepId, stepKind: input.stepKind ?? null, note },
        },
      }),
    ])
    return request
  }
  const [request] = await prisma.$transaction([retakeOperation, taskOperation])
  return request
}

/**
 * Новое фото шага закрывает открытый запрос пересъемки. Вызывается из
 * upload-роута после создания PhotoSubmission с captureStepId.
 */
export async function resolveCaptureRetakesForStep(
  prisma: PrismaClient,
  organizationId: string,
  taskId: string,
  stepId: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.captureRetakeRequest.updateMany({
      where: { organizationId, taskId, stepId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    })
    // Только если что-то реально закрыли — иначе не плодим лишние re-pull
    // задачи на каждое загруженное фото (docs/26 P0).
    if (result.count > 0) {
      await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } })
    }
    return result.count
  })
}

export interface OpenCaptureRetake {
  taskId: string
  stepId: string
  stepKind: string | null
  note: string | null
  requestedAt: string
}

/** Открытые запросы пересъемки по набору задач — для sync pull. */
export async function listOpenCaptureRetakes(
  prisma: PrismaClient,
  organizationId: string,
  taskIds: string[],
): Promise<Map<string, OpenCaptureRetake[]>> {
  const byTask = new Map<string, OpenCaptureRetake[]>()
  if (taskIds.length === 0) return byTask
  const rows = await prisma.captureRetakeRequest.findMany({
    where: { organizationId, taskId: { in: taskIds }, resolvedAt: null },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    select: { taskId: true, stepId: true, stepKind: true, note: true, requestedAt: true },
  })
  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? []
    list.push({
      taskId: row.taskId,
      stepId: row.stepId,
      stepKind: row.stepKind,
      note: row.note,
      requestedAt: row.requestedAt.toISOString(),
    })
    byTask.set(row.taskId, list)
  }
  return byTask
}
