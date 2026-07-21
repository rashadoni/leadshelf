import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  buildOfficeMorningDigest,
  createSystemClient,
  detectStockGapAlerts,
  emitProductEvent,
  expireOverdueTasks,
  opaqueRateLimitKey,
} from "@leadshelf/db"
import { processNextCatalogImportJob } from "./catalog-import/queue"
import { processPendingNotificationDeliveries } from "./notifications/push"
import {
  consumeProofAiBudget,
  processNextProofAnalysisJob,
  type ProofAnalysisStorage,
} from "./proof-analysis/processor"

const prisma = createSystemClient("worker-tenant-boundary-test")
const suffix = `${process.pid}-${randomUUID()}`
let organizationA = ""
let organizationB = ""
let batchB = ""
let importJobA = ""
let deliveryA = ""
let photoA = ""
let targetTaskB = ""

beforeAll(async () => {
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({
      data: { name: "Worker boundary A", slug: `worker-boundary-a-${suffix}` },
    }),
    prisma.organization.create({
      data: { name: "Worker boundary B", slug: `worker-boundary-b-${suffix}` },
    }),
  ])
  organizationA = orgA.id
  organizationB = orgB.id

  const userB = await prisma.user.create({
    data: {
      organizationId: organizationB,
      name: "Target user",
      email: `worker-boundary-${suffix}@example.test`,
      role: "FIELD_AGENT",
    },
  })
  const [storeB, deviceB] = await Promise.all([
    prisma.store.create({
      data: {
        organizationId: organizationB,
        name: "Target store",
        code: `WB-${suffix}`,
      },
    }),
    prisma.mobileDevice.create({
      data: {
        userId: userB.id,
        platform: "test",
        pushToken: "ExponentPushToken[cross-tenant-target]",
      },
    }),
  ])

  const batch = await prisma.importBatch.create({
    data: {
      organizationId: organizationB,
      source: "csv",
      entityType: "products",
      status: "PENDING",
    },
  })
  batchB = batch.id
  const job = await prisma.importQueueJob.create({
    data: {
      organizationId: organizationA,
      batchId: batch.id,
      entityType: "products",
      source: "csv",
      fileName: "cross-tenant.csv",
      storagePath: `/tmp/leadshelf-cross-tenant-${suffix}.csv`,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
      availableAt: new Date("2000-01-01T00:00:00.000Z"),
    },
  })
  importJobA = job.id

  const delivery = await prisma.notificationDelivery.create({
    data: {
      organizationId: organizationA,
      deviceId: deviceB.id,
      pushToken: deviceB.pushToken!,
      title: "Must not cross tenant",
      body: "private payload",
      status: "PENDING",
      availableAt: new Date("2000-01-01T00:00:00.000Z"),
    },
  })
  deliveryA = delivery.id

  const photo = await prisma.photoSubmission.create({
    data: {
      organizationId: organizationA,
      storeId: storeB.id,
      userId: userB.id,
      url: `photos/${organizationA}/corrupt.jpg`,
      mediaType: "PHOTO",
      mimeType: "image/jpeg",
      clientPhotoId: `worker-boundary-photo-${suffix}`,
      takenAt: new Date(),
      analysisStatus: "PENDING",
    },
  })
  photoA = photo.id
  const targetProduct = await prisma.product.create({
    data: {
      organizationId: organizationB,
      sku: `WB-SKU-${suffix}`,
      name: "Target stock gap",
    },
  })
  await prisma.storeAssortment.create({
    data: { storeId: storeB.id, productId: targetProduct.id, isActive: true },
  })
  const targetTask = await prisma.task.create({
    data: {
      organizationId: organizationB,
      storeId: storeB.id,
      assigneeId: userB.id,
      title: "Foreign overdue task",
      dueAt: new Date("2000-01-01T00:00:00.000Z"),
      status: "NEW",
    },
  })
  targetTaskB = targetTask.id
})

afterAll(async () => {
  if (organizationA) {
    await prisma.rateLimitBucket.deleteMany({
      where: {
        scope: "proof-ai",
        keyHash: opaqueRateLimitKey([organizationA]),
      },
    })
    await prisma.photoSubmission.deleteMany({ where: { organizationId: organizationA } })
    await prisma.notificationDelivery.deleteMany({ where: { organizationId: organizationA } })
    await prisma.importQueueJob.deleteMany({ where: { organizationId: organizationA } })
  }
  if (batchB) await prisma.importBatch.deleteMany({ where: { id: batchB } })
  if (organizationB) {
    await prisma.notificationDelivery.deleteMany({ where: { organizationId: organizationB } })
    await prisma.alert.deleteMany({ where: { organizationId: organizationB } })
    await prisma.productEvent.deleteMany({ where: { organizationId: organizationB } })
    await prisma.task.deleteMany({ where: { organizationId: organizationB } })
    await prisma.storeAssortment.deleteMany({ where: { store: { organizationId: organizationB } } })
    await prisma.product.deleteMany({ where: { organizationId: organizationB } })
    await prisma.mobileDevice.deleteMany({ where: { user: { organizationId: organizationB } } })
    await prisma.store.deleteMany({ where: { organizationId: organizationB } })
    await prisma.user.deleteMany({ where: { organizationId: organizationB } })
  }
  if (organizationA || organizationB) {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB].filter(Boolean) } },
    })
  }
  await prisma.$disconnect()
})

describe("background worker tenant boundary", () => {
  test("quarantines an import job linked to another tenant's batch", async () => {
    const result = await processNextCatalogImportJob(prisma, {
      now: new Date("2026-07-18T20:00:00.000Z"),
    })

    expect(result).toEqual({ jobId: importJobA, batchId: batchB, status: "FAILED" })
    await expect(prisma.importQueueJob.findUniqueOrThrow({ where: { id: importJobA } }))
      .resolves.toMatchObject({ status: "FAILED", error: "tenant_boundary_violation" })
    await expect(prisma.importBatch.findUniqueOrThrow({ where: { id: batchB } }))
      .resolves.toMatchObject({ organizationId: organizationB, status: "PENDING", totalRows: 0 })
  })

  test("does not send a delivery whose device belongs to another tenant", async () => {
    let sendCalls = 0
    const result = await processPendingNotificationDeliveries(prisma, organizationA, {
      now: new Date("2026-07-18T20:00:00.000Z"),
      sender: {
        send: async () => {
          sendCalls += 1
          return { ok: true }
        },
      },
    })

    expect(result).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 })
    expect(sendCalls).toBe(0)
    await expect(prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryA } }))
      .resolves.toMatchObject({ status: "FAILED", error: "tenant_boundary_violation", attempts: 0 })
  })

  test("does not read proof bytes when photo ownership links cross tenants", async () => {
    let storageReads = 0
    const storage: ProofAnalysisStorage = {
      getObjectBuffer: async () => {
        storageReads += 1
        return { body: Buffer.from("private"), contentType: "image/jpeg" }
      },
      putObjectBuffer: async () => undefined,
    }
    const result = await processNextProofAnalysisJob(prisma, {
      organizationId: organizationA,
      storage,
      now: () => new Date("2026-07-18T20:00:00.000Z"),
      analysisIdentity: { provider: "disabled", modelVersion: "test" },
    })

    expect(result).toEqual({
      status: "failed",
      photoSubmissionId: photoA,
      error: "tenant_boundary_violation",
    })
    expect(storageReads).toBe(0)
    await expect(prisma.photoSubmission.findUniqueOrThrow({ where: { id: photoA } }))
      .resolves.toMatchObject({
        organizationId: organizationA,
        analysisStatus: "FAILED",
        analysisError: "tenant_boundary_violation",
      })
    await expect(prisma.humanReview.count({ where: { organizationId: organizationA } }))
      .resolves.toBe(0)
  })

  test("scheduled task, stock and digest jobs ignore another tenant's rows", async () => {
    await emitProductEvent(prisma, organizationB, {
      kind: "task.overdue",
      severity: "critical",
      entityType: "task",
      entityId: targetTaskB,
      dedupeKey: `worker-boundary-event-${suffix}`,
      payload: { title: "Private target alert" },
    })

    const [expired, stockGaps, digestA] = await Promise.all([
      expireOverdueTasks(prisma, organizationA, {
        now: new Date("2026-07-18T20:00:00.000Z"),
      }),
      detectStockGapAlerts(prisma, organizationA, {
        date: new Date("2026-07-18T20:00:00.000Z"),
      }),
      buildOfficeMorningDigest(prisma, organizationA, {
        since: new Date("1999-01-01T00:00:00.000Z"),
        until: new Date("2026-07-18T21:00:00.000Z"),
      }),
    ])

    expect(expired).toMatchObject({ expiredCount: 0, taskIds: [] })
    expect(stockGaps).toMatchObject({ createdCount: 0, eventIds: [] })
    expect(digestA).toMatchObject({ total: 0, critical: 0 })
    await expect(prisma.task.findUniqueOrThrow({ where: { id: targetTaskB } }))
      .resolves.toMatchObject({ organizationId: organizationB, status: "NEW" })
    await expect(prisma.productEvent.count({ where: { organizationId: organizationA } }))
      .resolves.toBe(0)
  })

  test("serializes the external AI ceiling in a tenant PostgreSQL bucket", async () => {
    const previousMax = process.env.LEADSHELF_PROOF_AI_MAX_PER_WINDOW
    const previousWindow = process.env.LEADSHELF_PROOF_AI_WINDOW_MS
    process.env.LEADSHELF_PROOF_AI_MAX_PER_WINDOW = "1"
    process.env.LEADSHELF_PROOF_AI_WINDOW_MS = "60000"
    try {
      const now = new Date("2026-07-18T20:00:00.000Z")
      const [first, second] = await Promise.all([
        consumeProofAiBudget(prisma, organizationA, now),
        consumeProofAiBudget(prisma, organizationA, now),
      ])
      expect([first.allowed, second.allowed].sort()).toEqual([false, true])
      expect(first.retryAfterSeconds || second.retryAfterSeconds).toBe(60)
      await expect(prisma.rateLimitBucket.findUniqueOrThrow({
        where: {
          scope_keyHash: {
            scope: "proof-ai",
            keyHash: opaqueRateLimitKey([organizationA]),
          },
        },
      })).resolves.toMatchObject({ count: 2 })
    } finally {
      if (previousMax === undefined) delete process.env.LEADSHELF_PROOF_AI_MAX_PER_WINDOW
      else process.env.LEADSHELF_PROOF_AI_MAX_PER_WINDOW = previousMax
      if (previousWindow === undefined) delete process.env.LEADSHELF_PROOF_AI_WINDOW_MS
      else process.env.LEADSHELF_PROOF_AI_WINDOW_MS = previousWindow
    }
  })
})
