import type { Prisma, PrismaClient, TaskStatus } from "@prisma/client"
import { evaluateVisitGeofence } from "@leadshelf/core"
import { emitProductEvent } from "./alerts.ts"
import { createOrder, OrderRepoError } from "./orders.ts"
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

function cursorWhere(token: SyncCursorToken | null) {
  if (!token) return {}
  const at = new Date(token.u)
  return {
    OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: token.id } }],
  }
}

const PULL_LIMIT = 200

function isAfterCursor(token: SyncCursorToken | null, updatedAt: Date, id: string): boolean {
  if (!token) return true
  const cursorAt = new Date(token.u)
  const at = updatedAt.getTime()
  const cursor = cursorAt.getTime()
  return at > cursor || (at === cursor && id > token.id)
}

function latestDate(...dates: Array<Date | null | undefined>): Date {
  return dates.reduce<Date>((latest, date) => {
    if (!date) return latest
    return date > latest ? date : latest
  }, new Date(0))
}

function mapMobileReview(review: {
  id: string
  reason: "PHOTO_QUALITY" | "VISION_COMPLIANCE"
  status: "PENDING" | "APPROVED" | "REJECTED"
  score: number | null
  note: string | null
  reviewedAt: Date | null
  updatedAt: Date
}) {
  return {
    id: review.id,
    reason: review.reason,
    status: review.status,
    score: review.score,
    note: review.note,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
    updatedAt: review.updatedAt.toISOString(),
  }
}

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
  cursors: {
    tasks?: string | null
    planogramBundles?: string | null
    routes?: string | null
    visits?: string | null
    photoSubmissions?: string | null
  },
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
    select: { id: true, storeId: true, planogramVersionId: true },
  })
  const fieldAgent = await prisma.fieldAgent.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  })
  const routeCursor = decodeCursor(cursors.routes)
  const routes = fieldAgent
    ? await prisma.route.findMany({
        where: {
          organizationId,
          agentId: fieldAgent.id,
          isActive: true,
          ...cursorWhere(routeCursor),
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 50,
        include: { stops: { orderBy: { sortOrder: "asc" } } },
      })
    : []
  const lastRoute = routes[routes.length - 1]
  const nextRouteCursor = lastRoute
    ? encodeCursor({ u: lastRoute.updatedAt.toISOString(), id: lastRoute.id })
    : (cursors.routes ?? null)
  const routeStoreIds = routes.flatMap((route) => route.stops.map((stop) => stop.storeId))
  const storeIds = [...new Set([...allAssigned.map((t) => t.storeId), ...routeStoreIds])]
  const versionIds = [
    ...new Set(allAssigned.map((t) => t.planogramVersionId).filter((v): v is string => !!v)),
  ]
  const visitCursor = decodeCursor(cursors.visits)
  const visits = fieldAgent
    ? await prisma.visit.findMany({
        where: {
          organizationId,
          agentId: fieldAgent.id,
          ...cursorWhere(visitCursor),
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 100,
      })
    : []
  const lastVisit = visits[visits.length - 1]
  const nextVisitCursor = lastVisit
    ? encodeCursor({ u: lastVisit.updatedAt.toISOString(), id: lastVisit.id })
    : (cursors.visits ?? null)

  const assignedTaskIds = allAssigned.map((task) => task.id)
  const photoCursor = decodeCursor(cursors.photoSubmissions)
  const photoCandidates =
    assignedTaskIds.length > 0
      ? await prisma.photoSubmission.findMany({
          where: {
            organizationId,
            taskId: { in: assignedTaskIds },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: PULL_LIMIT * 5,
          select: {
            id: true,
            clientPhotoId: true,
            taskId: true,
            storeId: true,
            url: true,
            mediaType: true,
            durationMs: true,
            captureScenarioId: true,
            captureStepId: true,
            captureStepKind: true,
            captureStepSequence: true,
            captureRequired: true,
            captureMediaKind: true,
            captureMinDurationSeconds: true,
            captureMaxDurationSeconds: true,
            takenAt: true,
            qualityScore: true,
            createdAt: true,
            humanReviews: {
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              take: 5,
              select: {
                id: true,
                reason: true,
                status: true,
                score: true,
                note: true,
                reviewedAt: true,
                updatedAt: true,
              },
            },
          },
        })
      : []
  const photoSubmissions = photoCandidates
    .map((photo) => {
      const updatedAt = latestDate(photo.createdAt, ...photo.humanReviews.map((review) => review.updatedAt))
      return { photo, updatedAt }
    })
    .filter(({ photo, updatedAt }) => isAfterCursor(photoCursor, updatedAt, photo.id))
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.photo.id.localeCompare(b.photo.id))
    .slice(0, PULL_LIMIT)
  const lastPhoto = photoSubmissions[photoSubmissions.length - 1]
  const nextPhotoCursor = lastPhoto
    ? encodeCursor({ u: lastPhoto.updatedAt.toISOString(), id: lastPhoto.photo.id })
    : (cursors.photoSubmissions ?? null)

  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, code: true, address: true, latitude: true, longitude: true, formatId: true },
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
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      agentId: route.agentId,
      isActive: route.isActive,
      updatedAt: route.updatedAt.toISOString(),
      stops: route.stops.map((stop) => ({
        id: stop.id,
        routeId: stop.routeId,
        storeId: stop.storeId,
        sortOrder: stop.sortOrder,
        plannedAt: stop.plannedAt?.toISOString() ?? null,
      })),
    })),
    visits: visits.map((visit) => ({
      id: visit.id,
      agentId: visit.agentId,
      storeId: visit.storeId,
      routeStopId: visit.routeStopId,
      status: visit.status,
      checkInAt: visit.checkInAt?.toISOString() ?? null,
      checkOutAt: visit.checkOutAt?.toISOString() ?? null,
      anomalyFlags: visit.anomalyFlags,
      updatedAt: visit.updatedAt.toISOString(),
    })),
    photoSubmissions: photoSubmissions.map(({ photo, updatedAt }) => {
      const qualityReview = photo.humanReviews.find((review) => review.reason === "PHOTO_QUALITY")
      const visionReview = photo.humanReviews.find((review) => review.reason === "VISION_COMPLIANCE")
      return {
        id: photo.id,
        clientPhotoId: photo.clientPhotoId,
        taskId: photo.taskId!,
        storeId: photo.storeId,
        key: photo.url,
        mediaType: photo.mediaType === "VIDEO" ? "video" : "photo",
        durationMs: photo.durationMs,
        captureStep:
          photo.captureStepId && photo.captureStepKind
            ? {
                scenarioId: photo.captureScenarioId ?? "guided-shelf-proof-v1",
                stepId: photo.captureStepId,
                stepKind: photo.captureStepKind,
                required: photo.captureRequired ?? false,
                sequence: photo.captureStepSequence ?? 0,
                mediaKind: photo.captureMediaKind === "video" ? "video" : "photo",
                minDurationSeconds: photo.captureMinDurationSeconds,
                maxDurationSeconds: photo.captureMaxDurationSeconds,
              }
            : null,
        takenAt: photo.takenAt.toISOString(),
        qualityScore: photo.qualityScore,
        review: qualityReview ? mapMobileReview(qualityReview) : null,
        vision: visionReview ? mapMobileReview(visionReview) : null,
        updatedAt: updatedAt.toISOString(),
      }
    }),
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
        compressionX: p.compressionX,
        compressionY: p.compressionY,
        compressionZ: p.compressionZ,
        facingsX: p.facingsX,
        facingsY: p.facingsY,
        facingsZ: p.facingsZ,
        rotationX: p.rotationX,
        rotationY: p.rotationY,
        rotationZ: p.rotationZ,
        stackMode: p.stackMode,
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
    cursors: {
      tasks: nextTaskCursor,
      planogramBundles: nextBundleCursor,
      routes: nextRouteCursor,
      visits: nextVisitCursor,
      photoSubmissions: nextPhotoCursor,
    },
  }
}

export interface PushOperation {
  clientOpId: string
  kind:
    | "task.status"
    | "photo.submit"
    | "task.comment"
    | "visit.checkin"
    | "visit.checkout"
    | "location.update"
    | "order.create"
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

async function findUserAgent(prisma: PrismaClient, organizationId: string, userId: string) {
  return prisma.fieldAgent.findFirst({
    where: { organizationId, userId },
    select: { id: true, userId: true },
  })
}

async function applyVisitCheckIn(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  payload: {
    agentId: string
    storeId: string
    routeStopId?: string | null
    latitude: number
    longitude: number
    geofenceLimitM?: number
  },
): Promise<Omit<PushResult, "clientOpId">> {
  const agent = await findUserAgent(prisma, organizationId, userId)
  if (!agent || agent.id !== payload.agentId) return { status: "rejected", detail: "agent_not_found_or_not_self" }
  const store = await prisma.store.findFirst({
    where: { id: payload.storeId, organizationId, isActive: true },
    select: { id: true, latitude: true, longitude: true },
  })
  if (!store) return { status: "rejected", detail: "store_not_found" }
  const routeStop = payload.routeStopId
    ? await prisma.routeStop.findFirst({
        where: { id: payload.routeStopId, storeId: payload.storeId, route: { organizationId, agentId: agent.id } },
        select: { id: true },
      })
    : null
  if (payload.routeStopId && !routeStop) return { status: "rejected", detail: "route_stop_not_found" }

  const geofence = evaluateVisitGeofence({
    store: store.latitude !== null && store.longitude !== null ? { latitude: store.latitude, longitude: store.longitude } : null,
    checkIn: { latitude: payload.latitude, longitude: payload.longitude },
    limitM: payload.geofenceLimitM ?? 150,
  })
  const activeVisit = await prisma.visit.findFirst({
    where: {
      organizationId,
      agentId: agent.id,
      storeId: store.id,
      routeStopId: routeStop?.id ?? null,
      status: "IN_PROGRESS",
    },
    select: { id: true, anomalyFlags: true },
  })
  if (activeVisit) {
    return { status: "already_applied", detail: { visitId: activeVisit.id, anomalyFlags: activeVisit.anomalyFlags } }
  }

  const visit = await prisma.visit.create({
    data: {
      organizationId,
      agentId: agent.id,
      storeId: store.id,
      routeStopId: routeStop?.id,
      status: "IN_PROGRESS",
      checkInAt: new Date(),
      checkInLat: payload.latitude,
      checkInLng: payload.longitude,
      anomalyFlags: { geofence: { distanceM: geofence.distanceM, limitM: geofence.limitM, outside: geofence.outside } },
    },
    select: { id: true, anomalyFlags: true },
  })
  await prisma.agentLocation.create({
    data: { agentId: agent.id, latitude: payload.latitude, longitude: payload.longitude, recordedAt: new Date() },
  })
  if (geofence.outside) {
    await emitProductEvent(prisma, organizationId, {
      kind: "visit.anomaly",
      severity: "critical",
      storeId: store.id,
      entityType: "visit",
      entityId: visit.id,
      dedupeKey: `visit.anomaly:${visit.id}:geofence`,
      payload: {
        title: "Geofence breach",
        distanceM: geofence.distanceM,
        limitM: geofence.limitM,
      },
    })
  }
  return { status: "applied", detail: { visitId: visit.id, anomalyFlags: visit.anomalyFlags } }
}

async function applyVisitCheckOut(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  payload: { visitId: string },
): Promise<Omit<PushResult, "clientOpId">> {
  const agent = await findUserAgent(prisma, organizationId, userId)
  if (!agent) return { status: "rejected", detail: "agent_not_found" }
  const visit = await prisma.visit.findFirst({
    where: { id: payload.visitId, organizationId, agentId: agent.id },
    select: { id: true, status: true },
  })
  if (!visit) return { status: "rejected", detail: "visit_not_found" }
  if (visit.status === "COMPLETED") return { status: "already_applied", detail: { serverStatus: visit.status } }
  if (visit.status !== "IN_PROGRESS") return { status: "conflict", detail: { serverStatus: visit.status } }
  await prisma.visit.update({
    where: { id: visit.id },
    data: { status: "COMPLETED", checkOutAt: new Date() },
  })
  return { status: "applied" }
}

async function applyLocationUpdate(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  payload: { agentId: string; latitude: number; longitude: number; accuracyM?: number | null; recordedAt?: string },
): Promise<Omit<PushResult, "clientOpId">> {
  const agent = await findUserAgent(prisma, organizationId, userId)
  if (!agent || agent.id !== payload.agentId) return { status: "rejected", detail: "agent_not_found_or_not_self" }
  await prisma.agentLocation.create({
    data: {
      agentId: agent.id,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracyM: payload.accuracyM ?? null,
      recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : new Date(),
    },
  })
  return { status: "applied" }
}

async function applyOrderCreate(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  deviceId: string,
  clientOpId: string,
  payload: { storeId: string; visitId?: string | null; lines: Array<{ productId: string; quantity: number }> },
): Promise<Omit<PushResult, "clientOpId">> {
  try {
    const order = await createOrder(prisma, organizationId, {
      ...payload,
      userId,
      deviceId,
      clientOpId,
    })
    return { status: "applied", detail: { order } }
  } catch (error) {
    if (error instanceof OrderRepoError) {
      const rejectedCodes = new Set([
        "store_not_found",
        "visit_not_found",
        "visit_store_mismatch",
        "product_not_found",
        "product_price_missing",
        "credit_limit_exceeded",
        "credit_account_blocked",
      ])
      return {
        status: rejectedCodes.has(error.code) ? "rejected" : "conflict",
        detail: { code: error.code, detail: error.detail },
      }
    }
    throw error
  }
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
    } else if (op.kind === "visit.checkin") {
      result = await applyVisitCheckIn(prisma, organizationId, userId, op.payload as never)
    } else if (op.kind === "visit.checkout") {
      result = await applyVisitCheckOut(prisma, organizationId, userId, op.payload as never)
    } else if (op.kind === "location.update") {
      result = await applyLocationUpdate(prisma, organizationId, userId, op.payload as never)
    } else if (op.kind === "order.create") {
      result = await applyOrderCreate(prisma, organizationId, userId, deviceId, op.clientOpId, op.payload as never)
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
