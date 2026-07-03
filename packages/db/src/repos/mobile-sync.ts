import type { Prisma, PrismaClient, TaskStatus } from "@prisma/client"
import { transitionTaskStatus } from "./publish.ts"
import { PlanogramRepoError } from "./planogram.ts"

// Delta-sync (порт mtm-offline-sync-spec, дизайн docs/18):
// pull (server->client, курсор {updatedAt,id} на коллекцию) ->
// push (client->server, идемпотентность deviceId+clientOpId, сервер
// побеждает в конфликтах, конфликт фиксируется SyncConflict) ->
// ack (клиент подтверждает применение — только тогда двигаем SyncCursor).

export interface SyncCursorToken {
  u: string // updatedAt ISO
  id: string
}

export function encodeCursor(c: SyncCursorToken): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url")
}

export function decodeCursor(raw: string | undefined | null): SyncCursorToken | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"))
    if (typeof parsed.u === "string" && typeof parsed.id === "string") return parsed
    return null
  } catch {
    return null
  }
}

function cursorWhere(token: SyncCursorToken | null): Prisma.TaskWhereInput {
  if (!token) return {}
  const at = new Date(token.u)
  return {
    OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: token.id } }],
  }
}

const PULL_LIMIT = 200

type TaskLocationHint = {
  source: "STORE_FLOOR_PLAN" | "FORMAT_FLOOR_PLAN"
  floorPlanName: string | null
  label: string | null
  equipmentName: string | null
  xMm: number | null
  yMm: number | null
  rotationDeg: number | null
}

function floorPlanHintKey(target: "store" | "format", targetId: string, planogramId: string): string {
  return `${target}:${targetId}:${planogramId}`
}

export async function pullChanges(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  cursors: { tasks?: string | null; planogramBundles?: string | null },
) {
  // Пилотный скоуп: только НАЗНАЧЕННЫЕ задачи (docs/18 решение b)
  const taskCursor = decodeCursor(cursors.tasks)
  const tasks = await prisma.task.findMany({
    where: {
      organizationId,
      assigneeId: userId,
      ...cursorWhere(taskCursor),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PULL_LIMIT,
    include: { store: { select: { id: true, name: true, code: true, address: true } } },
  })
  const lastTask = tasks[tasks.length - 1]
  const nextTaskCursor = lastTask
    ? encodeCursor({ u: lastTask.updatedAt.toISOString(), id: lastTask.id })
    : (cursors.tasks ?? null)

  // Все назначенные задачи пользователя определяют точки и планограммы
  const allAssigned = await prisma.task.findMany({
    where: { organizationId, assigneeId: userId },
    select: { storeId: true, planogramVersionId: true },
  })
  const storeIds = [...new Set(allAssigned.map((t) => t.storeId))]
  const versionIds = [
    ...new Set(allAssigned.map((t) => t.planogramVersionId).filter((v): v is string => !!v)),
  ]

  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, code: true, address: true, formatId: true },
  })
  const storeFormatById = new Map(stores.map((s) => [s.id, s.formatId]))
  const formatIds = [...new Set(stores.map((s) => s.formatId).filter((id): id is string => !!id))]
  const assignedVersions = await prisma.planogramVersion.findMany({
    where: { id: { in: versionIds } },
    select: { id: true, planogramId: true },
  })
  const planogramIdByVersion = new Map(assignedVersions.map((v) => [v.id, v.planogramId]))
  const planogramIds = [...new Set(assignedVersions.map((v) => v.planogramId))]

  const hintByTarget = new Map<string, TaskLocationHint>()
  if (planogramIds.length > 0 && (storeIds.length > 0 || formatIds.length > 0)) {
    const targetFilters: Prisma.FloorPlanWhereInput[] = []
    if (storeIds.length > 0) targetFilters.push({ storeId: { in: storeIds } })
    if (formatIds.length > 0) targetFilters.push({ formatId: { in: formatIds } })

    const floorPlanVersions = await prisma.floorPlanVersion.findMany({
      where: {
        isPublished: true,
        floorPlan: { organizationId, OR: targetFilters },
        equipment: { some: { planogramId: { in: planogramIds } } },
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        floorPlan: { select: { name: true, storeId: true, formatId: true } },
        equipment: {
          where: { planogramId: { in: planogramIds } },
          orderBy: [{ xMm: "asc" }, { yMm: "asc" }],
          select: {
            planogramId: true,
            label: true,
            xMm: true,
            yMm: true,
            rotationDeg: true,
            equipmentVersion: { select: { template: { select: { name: true } } } },
          },
        },
      },
    })

    for (const version of floorPlanVersions) {
      for (const eq of version.equipment) {
        if (!eq.planogramId) continue
        const hint = {
          floorPlanName: version.floorPlan.name,
          label: eq.label,
          equipmentName: eq.equipmentVersion.template.name,
          xMm: eq.xMm,
          yMm: eq.yMm,
          rotationDeg: eq.rotationDeg,
        }
        if (version.floorPlan.storeId) {
          const key = floorPlanHintKey("store", version.floorPlan.storeId, eq.planogramId)
          if (!hintByTarget.has(key)) {
            hintByTarget.set(key, { source: "STORE_FLOOR_PLAN", ...hint })
          }
        }
        if (version.floorPlan.formatId) {
          const key = floorPlanHintKey("format", version.floorPlan.formatId, eq.planogramId)
          if (!hintByTarget.has(key)) {
            hintByTarget.set(key, { source: "FORMAT_FLOOR_PLAN", ...hint })
          }
        }
      }
    }
  }

  // Бандлы опубликованных версий immutable — курсор по publishedAt
  const bundleCursor = decodeCursor(cursors.planogramBundles)
  const versions = await prisma.planogramVersion.findMany({
    where: {
      id: { in: versionIds },
      state: "PUBLISHED",
      ...(bundleCursor
        ? {
            OR: [
              { publishedAt: { gt: new Date(bundleCursor.u) } },
              { publishedAt: new Date(bundleCursor.u), id: { gt: bundleCursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    take: 20, // бандлы тяжелые
    include: {
      planogram: { select: { id: true, name: true } },
      equipment: {
        include: {
          equipmentVersion: {
            include: {
              template: { select: { name: true } },
              shelves: { orderBy: { shelfIndex: "asc" } },
            },
          },
        },
      },
      placements: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
              brand: { select: { name: true } },
              barcodes: { where: { isPrimary: true }, select: { barcode: true } },
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            },
          },
        },
      },
    },
  })
  const lastVersion = versions[versions.length - 1]
  const nextBundleCursor = lastVersion?.publishedAt
    ? encodeCursor({ u: lastVersion.publishedAt.toISOString(), id: lastVersion.id })
    : (cursors.planogramBundles ?? null)

  return {
    tasks: tasks.map((t) => {
      const planogramId = t.planogramVersionId
        ? (planogramIdByVersion.get(t.planogramVersionId) ?? null)
        : null
      const formatId = storeFormatById.get(t.storeId) ?? null
      const locationHint = planogramId
        ? (hintByTarget.get(floorPlanHintKey("store", t.storeId, planogramId)) ??
          (formatId ? hintByTarget.get(floorPlanHintKey("format", formatId, planogramId)) : null) ??
          null)
        : null

      return {
        id: t.id,
        title: t.title,
        status: t.status,
        dueAt: t.dueAt?.toISOString() ?? null,
        storeId: t.storeId,
        planogramVersionId: t.planogramVersionId,
        locationHint,
        updatedAt: t.updatedAt.toISOString(),
      }
    }),
    stores: stores.map(({ formatId: _formatId, ...store }) => store),
    planogramBundles: versions.map((v) => ({
      versionId: v.id,
      versionNumber: v.versionNumber,
      planogram: v.planogram,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      equipment: v.equipment.map((eq) => ({
        planogramEquipmentId: eq.id,
        name: eq.equipmentVersion.template.name,
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
      })),
      placements: v.placements.map((p) => ({
        id: p.id,
        shelfId: p.shelfId,
        xMm: p.xMm,
        yMm: p.yMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        depthMm: p.depthMm,
        facingsX: p.facingsX,
        facingsY: p.facingsY,
        facingsZ: p.facingsZ,
        product: {
          id: p.product.id,
          sku: p.product.sku,
          name: p.product.name,
          unit: p.product.unit,
          brandName: p.product.brand?.name ?? null,
          barcode: p.product.barcodes[0]?.barcode ?? null,
          imageKey: p.product.images[0]?.url ?? null,
        },
      })),
    })),
    cursors: { tasks: nextTaskCursor, planogramBundles: nextBundleCursor },
  }
}

export interface PushOperation {
  clientOpId: string
  kind: "task.status" | "photo.submit" | "task.comment"
  payload: Record<string, unknown>
  clientCreatedAt?: string
}

export interface PushResult {
  clientOpId: string
  status: "applied" | "already_applied" | "conflict" | "rejected"
  detail?: unknown
}

async function applyTaskStatus(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  deviceId: string,
  payload: { taskId: string; expectedStatus: TaskStatus; toStatus: TaskStatus },
): Promise<Omit<PushResult, "clientOpId">> {
  const task = await prisma.task.findFirst({
    where: { id: payload.taskId, organizationId, assigneeId: userId },
    select: { id: true, status: true },
  })
  if (!task) return { status: "rejected", detail: "task_not_found_or_not_assigned" }
  if (task.status === payload.toStatus) {
    return { status: "already_applied", detail: { serverStatus: task.status } }
  }
  try {
    await transitionTaskStatus(prisma, organizationId, {
      taskId: payload.taskId,
      expectedStatus: payload.expectedStatus,
      toStatus: payload.toStatus,
      byUserId: userId,
    })
    return { status: "applied" }
  } catch (e) {
    if (e instanceof PlanogramRepoError) {
      // сервер побеждает; конфликт фиксируем для видимости (docs/18)
      await prisma.syncConflict.create({
        data: {
          deviceId,
          collection: "tasks",
          entityId: payload.taskId,
          serverData: { status: task.status },
          clientData: payload as object,
          resolution: "server_wins",
          resolvedAt: new Date(),
        },
      })
      return { status: "conflict", detail: { serverStatus: task.status, reason: e.code } }
    }
    throw e
  }
}

async function applyPhotoSubmit(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  deviceId: string,
  payload: { clientPhotoId: string; taskId: string },
): Promise<Omit<PushResult, "clientOpId">> {
  const photo = await prisma.photoSubmission.findFirst({
    where: { organizationId, clientPhotoId: payload.clientPhotoId },
    select: { id: true, taskId: true },
  })
  if (!photo) {
    // метаданные пришли раньше самого файла — клиент ретраит после upload
    return { status: "rejected", detail: "photo_not_uploaded_yet" }
  }
  const statusResult = await applyTaskStatus(prisma, organizationId, userId, deviceId, {
    taskId: payload.taskId,
    expectedStatus: "IN_PROGRESS",
    toStatus: "PHOTO_SUBMITTED",
  })
  // фото никогда не выбрасываем: даже при конфликте статуса оно сохранено
  return statusResult.status === "rejected"
    ? { status: "conflict", detail: statusResult.detail }
    : statusResult
}

async function applyTaskComment(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  payload: { taskId: string; body: string },
): Promise<Omit<PushResult, "clientOpId">> {
  const body = payload.body.trim()
  if (!body) return { status: "rejected", detail: "empty_comment" }
  const task = await prisma.task.findFirst({
    where: { id: payload.taskId, organizationId, assigneeId: userId },
    select: { id: true },
  })
  if (!task) return { status: "rejected", detail: "task_not_found_or_not_assigned" }
  await prisma.taskComment.create({
    data: {
      taskId: task.id,
      userId,
      body,
    },
  })
  return { status: "applied" }
}

export async function pushOperations(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  deviceId: string,
  operations: PushOperation[],
): Promise<PushResult[]> {
  const results: PushResult[] = []
  for (const op of operations) {
    const existing = await prisma.outboxOperation.findUnique({
      where: { deviceId_clientOpId: { deviceId, clientOpId: op.clientOpId } },
      select: { result: true },
    })
    if (existing) {
      results.push({
        clientOpId: op.clientOpId,
        ...(existing.result as Omit<PushResult, "clientOpId">),
      })
      continue
    }

    let result: Omit<PushResult, "clientOpId">
    if (op.kind === "task.status") {
      result = await applyTaskStatus(
        prisma,
        organizationId,
        userId,
        deviceId,
        op.payload as never,
      )
    } else if (op.kind === "photo.submit") {
      result = await applyPhotoSubmit(
        prisma,
        organizationId,
        userId,
        deviceId,
        op.payload as never,
      )
    } else if (op.kind === "task.comment") {
      result = await applyTaskComment(prisma, organizationId, userId, op.payload as never)
    } else {
      result = { status: "rejected", detail: "unknown_kind" }
    }

    await prisma.outboxOperation.create({
      data: {
        deviceId,
        clientOpId: op.clientOpId,
        kind: op.kind,
        payload: op.payload as object,
        status: result.status === "rejected" ? "FAILED" : "APPLIED",
        result: result as object,
        processedAt: new Date(),
      },
    })
    results.push({ clientOpId: op.clientOpId, ...result })
  }
  return results
}

export async function ackCursors(
  prisma: PrismaClient,
  deviceId: string,
  applied: Record<string, string>,
): Promise<void> {
  for (const [collection, cursor] of Object.entries(applied)) {
    await prisma.syncCursor.upsert({
      where: { deviceId_collection: { deviceId, collection } },
      update: { cursor },
      create: { deviceId, collection, cursor },
    })
  }
}

export async function storedCursors(
  prisma: PrismaClient,
  deviceId: string,
): Promise<Record<string, string>> {
  const rows = await prisma.syncCursor.findMany({ where: { deviceId } })
  return Object.fromEntries(rows.map((r) => [r.collection, r.cursor]))
}
