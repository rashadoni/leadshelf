import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { createTemplateWithVersion } from "@leadshelf/db"
import { GET as getImportBatch } from "@/app/api/v1/catalog/imports/[batchId]/route"
import { GET as getImportErrors } from "@/app/api/v1/catalog/imports/[batchId]/errors/route"
import { PATCH as patchProduct } from "@/app/api/v1/catalog/products/[id]/route"
import { POST as postProductImage } from "@/app/api/v1/catalog/products/[id]/images/route"
import { GET as getEquipment } from "@/app/api/v1/equipment/templates/[id]/route"
import { POST as copyEquipment } from "@/app/api/v1/equipment/templates/[id]/copy/route"
import { PUT as putEquipmentVersion } from "@/app/api/v1/equipment/templates/[id]/version/route"
import { PATCH as patchAgent } from "@/app/api/v1/field-force/agents/[agentId]/route"
import {
  DELETE as deleteRoute,
  PATCH as patchRoute,
} from "@/app/api/v1/field-force/routes/[routeId]/route"
import { POST as checkoutVisit } from "@/app/api/v1/field-force/visits/[visitId]/check-out/route"
import { PATCH as patchFloorPlan } from "@/app/api/v1/floor-plans/[id]/route"
import { POST as copyFloorPlan } from "@/app/api/v1/floor-plans/[id]/copy-to-store/route"
import { GET as getMobileMedia } from "@/app/api/v1/mobile/media/[...path]/route"
import { POST as createNextDraft } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/next-draft/route"
import { POST as createPlacement } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/placements/route"
import {
  DELETE as deletePlacement,
  PATCH as patchPlacement,
} from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/placements/[placementId]/route"
import { POST as publishPlanogram } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/publish/route"
import { POST as createZone } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/zones/route"
import {
  DELETE as deleteZone,
} from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/zones/[zoneId]/route"
import { POST as autofillZone } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/zones/[zoneId]/autofill/route"
import { POST as createGoldenReference } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/golden-reference/route"
import {
  DELETE as deleteGoldenReference,
  PATCH as patchGoldenReference,
} from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/golden-reference/[referenceId]/route"
import { POST as createGoldenSlot } from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/golden-reference/[referenceId]/slots/route"
import {
  DELETE as deleteGoldenSlot,
  PATCH as patchGoldenSlot,
} from "@/app/api/v1/planograms/[planogramId]/versions/[versionId]/golden-reference/[referenceId]/slots/[slotId]/route"
import { PUT as putReviewAnnotations } from "@/app/api/v1/reviews/[reviewId]/annotations/route"
import { PATCH as patchReviewStatus } from "@/app/api/v1/reviews/[reviewId]/status/route"
import { PATCH as assignTask } from "@/app/api/v1/tasks/[taskId]/assign/route"
import { POST as requestRetake } from "@/app/api/v1/tasks/[taskId]/capture-retake/route"
import { PATCH as patchTaskStatus } from "@/app/api/v1/tasks/[taskId]/status/route"
import { signAccessToken } from "@/server/auth/jwt"
import { workerDb } from "@/server/db/client"

type Params = Record<string, string | string[]>
type Handler = unknown

const suffix = `${process.pid}-${randomUUID()}`
let organizationA = ""
let organizationB = ""
let attackerToken = ""
let targetUserId = ""
let targetStoreId = ""
let targetFormatId = ""
let targetBatchId = ""
let targetProductId = ""
let targetTemplateId = ""
let targetAgentId = ""
let targetRouteId = ""
let targetVisitId = ""
let targetFloorPlanId = ""
let targetPlanogramId = ""
let targetVersionId = ""
let targetShelfId = ""
let targetZoneId = ""
let targetPlacementId = ""
let targetTaskId = ""
let targetPhotoId = ""
let targetReviewId = ""
let targetReferenceId = ""
let targetSlotId = ""
let targetRevision = ""

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${attackerToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function invoke(
  handler: Handler,
  path: string,
  method: string,
  params: Params,
  body?: unknown,
): Promise<Response> {
  const routeHandler = handler as (
    routeRequest: NextRequest,
    context: { params: Promise<Params> },
  ) => Promise<Response>
  return routeHandler(request(path, method, body), { params: Promise.resolve(params) })
}

beforeAll(async () => {
  process.env.JWT_SECRET ||= `idor-matrix-${randomUUID()}`
  const [orgA, orgB] = await Promise.all([
    workerDb.organization.create({
      data: { name: "IDOR attacker", slug: `idor-attacker-${suffix}` },
    }),
    workerDb.organization.create({
      data: { name: "IDOR target", slug: `idor-target-${suffix}` },
    }),
  ])
  organizationA = orgA.id
  organizationB = orgB.id

  const [attacker, targetUser, storeFormat] = await Promise.all([
    workerDb.user.create({
      data: {
        organizationId: organizationA,
        name: "Attacker admin",
        email: `attacker-${suffix}@example.test`,
        role: "ADMIN",
      },
    }),
    workerDb.user.create({
      data: {
        organizationId: organizationB,
        name: "Target agent",
        email: `target-${suffix}@example.test`,
        employeeCode: `target-${suffix}`,
        role: "FIELD_AGENT",
      },
    }),
    workerDb.storeFormat.create({
      data: { organizationId: organizationB, name: "Target format" },
    }),
  ])
  targetUserId = targetUser.id
  targetFormatId = storeFormat.id
  attackerToken = await signAccessToken({
    sub: attacker.id,
    org: organizationA,
    role: "ADMIN",
    sid: `idor-session-${suffix}`,
  })

  const store = await workerDb.store.create({
    data: {
      organizationId: organizationB,
      formatId: targetFormatId,
      name: "Target store",
      code: `IDOR-${suffix}`,
    },
  })
  targetStoreId = store.id

  const equipmentType = await workerDb.equipmentType.create({
    data: { organizationId: organizationB, name: "Target rack", kind: "rack" },
  })
  const template = await createTemplateWithVersion(workerDb, organizationB, {
    name: "Target equipment",
    typeId: equipmentType.id,
    geometry: { widthMm: 1200, heightMm: 1800, depthMm: 400 },
    shelves: [{
      shelfIndex: 0,
      yMm: 100,
      thicknessMm: 20,
      depthMm: 400,
    }],
  })
  targetTemplateId = template.templateId
  const equipmentVersion = await workerDb.equipmentVersion.findFirstOrThrow({
    where: { templateId: targetTemplateId },
    include: { shelves: true },
  })
  targetShelfId = equipmentVersion.shelves[0]!.id

  const product = await workerDb.product.create({
    data: {
      organizationId: organizationB,
      sku: `IDOR-SKU-${suffix}`,
      name: "Target product",
      widthMm: 100,
      heightMm: 150,
      depthMm: 80,
    },
  })
  targetProductId = product.id

  const planogram = await workerDb.planogram.create({
    data: { organizationId: organizationB, name: "Target planogram" },
  })
  targetPlanogramId = planogram.id
  const version = await workerDb.planogramVersion.create({
    data: { planogramId: planogram.id, versionNumber: 1, state: "DRAFT" },
  })
  targetVersionId = version.id
  const planogramEquipment = await workerDb.planogramEquipment.create({
    data: {
      planogramVersionId: version.id,
      equipmentVersionId: equipmentVersion.id,
    },
  })
  const zone = await workerDb.planogramZone.create({
    data: {
      planogramVersionId: version.id,
      planogramEquipmentId: planogramEquipment.id,
      name: "Target zone",
      xMm: 0,
      yMm: 0,
      widthMm: 600,
      heightMm: 600,
    },
  })
  targetZoneId = zone.id
  const placement = await workerDb.planogramPlacement.create({
    data: {
      planogramVersionId: version.id,
      planogramEquipmentId: planogramEquipment.id,
      shelfId: targetShelfId,
      zoneId: zone.id,
      productId: product.id,
      xMm: 0,
      yMm: 120,
      widthMm: 100,
      heightMm: 150,
      depthMm: 80,
    },
  })
  targetPlacementId = placement.id
  targetRevision = (await workerDb.planogramVersion.findUniqueOrThrow({
    where: { id: version.id },
    select: { updatedAt: true },
  })).updatedAt.toISOString()

  const floorPlan = await workerDb.floorPlan.create({
    data: {
      organizationId: organizationB,
      formatId: targetFormatId,
      name: "Target floor plan",
    },
  })
  targetFloorPlanId = floorPlan.id
  await workerDb.floorPlanVersion.create({
    data: {
      floorPlanId: floorPlan.id,
      versionNumber: 1,
      widthMm: 10_000,
      depthMm: 8_000,
      isPublished: true,
      publishedAt: new Date(),
    },
  })

  const agent = await workerDb.fieldAgent.create({
    data: {
      organizationId: organizationB,
      userId: targetUserId,
      employeeCode: `agent-${suffix}`,
      phone: "+994500000000",
    },
  })
  targetAgentId = agent.id
  const route = await workerDb.route.create({
    data: {
      organizationId: organizationB,
      name: "Target route",
      agentId: agent.id,
      weekdays: [],
    },
  })
  targetRouteId = route.id
  const visit = await workerDb.visit.create({
    data: {
      organizationId: organizationB,
      agentId: agent.id,
      storeId: store.id,
      status: "IN_PROGRESS",
      checkInAt: new Date(),
    },
  })
  targetVisitId = visit.id

  const task = await workerDb.task.create({
    data: {
      organizationId: organizationB,
      storeId: store.id,
      assigneeId: targetUserId,
      title: "Target task",
      status: "NEW",
    },
  })
  targetTaskId = task.id
  const photo = await workerDb.photoSubmission.create({
    data: {
      organizationId: organizationB,
      storeId: store.id,
      taskId: task.id,
      userId: targetUserId,
      url: `photos/${organizationB}/idor.jpg`,
      clientPhotoId: `idor-photo-${suffix}`,
      takenAt: new Date(),
    },
  })
  targetPhotoId = photo.id
  const review = await workerDb.humanReview.create({
    data: {
      organizationId: organizationB,
      reason: "VISION_COMPLIANCE",
      taskId: task.id,
      photoSubmissionId: photo.id,
      planogramVersionId: version.id,
    },
  })
  targetReviewId = review.id
  const reference = await workerDb.goldenReference.create({
    data: {
      organizationId: organizationB,
      planogramVersionId: version.id,
      photoSubmissionId: photo.id,
      imageUrl: photo.url,
      createdById: targetUserId,
    },
  })
  targetReferenceId = reference.id
  const slot = await workerDb.goldenReferenceSlot.create({
    data: {
      goldenReferenceId: reference.id,
      placementId: placement.id,
      productId: product.id,
      xPct: 5,
      yPct: 5,
      widthPct: 20,
      heightPct: 20,
      label: "Target slot",
    },
  })
  targetSlotId = slot.id
  const batch = await workerDb.importBatch.create({
    data: {
      organizationId: organizationB,
      source: "csv",
      entityType: "products",
      status: "COMPLETED",
    },
  })
  targetBatchId = batch.id
})

afterAll(async () => {
  if (organizationB) {
    await workerDb.planogramPlacement.deleteMany({
      where: { planogramVersion: { planogram: { organizationId: organizationB } } },
    })
    await workerDb.goldenReferenceSlot.deleteMany({
      where: { goldenReference: { organizationId: organizationB } },
    })
    await workerDb.humanReview.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.goldenReference.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.photoSubmission.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.captureRetakeRequest.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.task.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.visit.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.route.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.fieldAgent.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.floorPlan.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.planogram.deleteMany({ where: { organizationId: organizationB } })
    await workerDb.product.deleteMany({ where: { organizationId: organizationB } })
  }
  if (organizationA || organizationB) {
    await workerDb.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB].filter(Boolean) } },
    })
  }
})

describe("dynamic IDOR matrix", () => {
  it("rejects tenant A access to every existing tenant B ID route without mutation", async () => {
    const revisionBody = { expectedRevision: targetRevision }
    const nested = { planogramId: targetPlanogramId, versionId: targetVersionId }
    const cases: Array<{
      name: string
      handler: Handler
      path: string
      method: string
      params: Params
      body?: unknown
      expected?: number
    }> = [
      { name: "import batch", handler: getImportBatch, path: `/api/v1/catalog/imports/${targetBatchId}`, method: "GET", params: { batchId: targetBatchId } },
      { name: "import errors", handler: getImportErrors, path: `/api/v1/catalog/imports/${targetBatchId}/errors`, method: "GET", params: { batchId: targetBatchId } },
      { name: "product patch", handler: patchProduct, path: `/api/v1/catalog/products/${targetProductId}`, method: "PATCH", params: { id: targetProductId }, body: { name: "Attacker edit" } },
      { name: "product image", handler: postProductImage, path: `/api/v1/catalog/products/${targetProductId}/images`, method: "POST", params: { id: targetProductId } },
      { name: "equipment read", handler: getEquipment, path: `/api/v1/equipment/templates/${targetTemplateId}`, method: "GET", params: { id: targetTemplateId } },
      { name: "equipment copy", handler: copyEquipment, path: `/api/v1/equipment/templates/${targetTemplateId}/copy`, method: "POST", params: { id: targetTemplateId }, body: {} },
      { name: "equipment version", handler: putEquipmentVersion, path: `/api/v1/equipment/templates/${targetTemplateId}/version`, method: "PUT", params: { id: targetTemplateId }, body: { expectedVersionNumber: 1, widthMm: 1200, heightMm: 1800, depthMm: 400, shelves: [] } },
      { name: "agent patch", handler: patchAgent, path: `/api/v1/field-force/agents/${targetAgentId}`, method: "PATCH", params: { agentId: targetAgentId }, body: { phone: "+994511111111" } },
      { name: "route patch", handler: patchRoute, path: `/api/v1/field-force/routes/${targetRouteId}`, method: "PATCH", params: { routeId: targetRouteId }, body: { name: "Attacker route" } },
      { name: "route delete", handler: deleteRoute, path: `/api/v1/field-force/routes/${targetRouteId}`, method: "DELETE", params: { routeId: targetRouteId } },
      { name: "visit checkout", handler: checkoutVisit, path: `/api/v1/field-force/visits/${targetVisitId}/check-out`, method: "POST", params: { visitId: targetVisitId } },
      { name: "floor plan patch", handler: patchFloorPlan, path: `/api/v1/floor-plans/${targetFloorPlanId}`, method: "PATCH", params: { id: targetFloorPlanId }, body: { name: "Attacker floor", storeId: targetStoreId, widthMm: 10000, depthMm: 8000, equipment: [] } },
      { name: "floor plan copy", handler: copyFloorPlan, path: `/api/v1/floor-plans/${targetFloorPlanId}/copy-to-store`, method: "POST", params: { id: targetFloorPlanId }, body: { storeId: targetStoreId } },
      { name: "mobile media", handler: getMobileMedia, path: `/api/v1/mobile/media/photos/${organizationB}/idor.jpg`, method: "GET", params: { path: ["photos", organizationB, "idor.jpg"] }, expected: 403 },
      { name: "next draft", handler: createNextDraft, path: "/api/v1/planograms/foreign/next-draft", method: "POST", params: nested },
      { name: "placement create", handler: createPlacement, path: "/api/v1/planograms/foreign/placements", method: "POST", params: nested, body: { ...revisionBody, shelfId: targetShelfId, productId: targetProductId } },
      { name: "placement patch", handler: patchPlacement, path: "/api/v1/planograms/foreign/placement", method: "PATCH", params: { ...nested, placementId: targetPlacementId }, body: { ...revisionBody, facingsX: 2 } },
      { name: "placement delete", handler: deletePlacement, path: "/api/v1/planograms/foreign/placement", method: "DELETE", params: { ...nested, placementId: targetPlacementId }, body: revisionBody },
      { name: "publish", handler: publishPlanogram, path: "/api/v1/planograms/foreign/publish", method: "POST", params: nested, body: { ...revisionBody, target: { type: "STORES", storeIds: [targetStoreId] } } },
      { name: "zone create", handler: createZone, path: "/api/v1/planograms/foreign/zones", method: "POST", params: nested, body: { ...revisionBody, name: "Attack", xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 } },
      { name: "zone delete", handler: deleteZone, path: "/api/v1/planograms/foreign/zone", method: "DELETE", params: { ...nested, zoneId: targetZoneId }, body: revisionBody },
      { name: "zone autofill", handler: autofillZone, path: "/api/v1/planograms/foreign/autofill", method: "POST", params: { ...nested, zoneId: targetZoneId }, body: { ...revisionBody, preview: true } },
      { name: "golden reference create", handler: createGoldenReference, path: "/api/v1/planograms/foreign/golden", method: "POST", params: nested, body: { photoSubmissionId: targetPhotoId } },
      { name: "golden reference patch", handler: patchGoldenReference, path: "/api/v1/planograms/foreign/golden", method: "PATCH", params: { ...nested, referenceId: targetReferenceId }, body: { status: "ARCHIVED" } },
      { name: "golden reference delete", handler: deleteGoldenReference, path: "/api/v1/planograms/foreign/golden", method: "DELETE", params: { ...nested, referenceId: targetReferenceId } },
      { name: "golden slot create", handler: createGoldenSlot, path: "/api/v1/planograms/foreign/slot", method: "POST", params: { ...nested, referenceId: targetReferenceId }, body: { placementId: targetPlacementId, xPct: 10, yPct: 10, widthPct: 10, heightPct: 10 } },
      { name: "golden slot patch", handler: patchGoldenSlot, path: "/api/v1/planograms/foreign/slot", method: "PATCH", params: { ...nested, referenceId: targetReferenceId, slotId: targetSlotId }, body: { label: "Attacker slot" } },
      { name: "golden slot delete", handler: deleteGoldenSlot, path: "/api/v1/planograms/foreign/slot", method: "DELETE", params: { ...nested, referenceId: targetReferenceId, slotId: targetSlotId } },
      { name: "review annotations", handler: putReviewAnnotations, path: `/api/v1/reviews/${targetReviewId}/annotations`, method: "PUT", params: { reviewId: targetReviewId }, body: { annotations: [] } },
      { name: "review status", handler: patchReviewStatus, path: `/api/v1/reviews/${targetReviewId}/status`, method: "PATCH", params: { reviewId: targetReviewId }, body: { status: "APPROVED" } },
      { name: "task assign", handler: assignTask, path: `/api/v1/tasks/${targetTaskId}/assign`, method: "PATCH", params: { taskId: targetTaskId }, body: { assigneeId: null } },
      { name: "task retake", handler: requestRetake, path: `/api/v1/tasks/${targetTaskId}/capture-retake`, method: "POST", params: { taskId: targetTaskId }, body: { stepId: "overview" } },
      { name: "task status", handler: patchTaskStatus, path: `/api/v1/tasks/${targetTaskId}/status`, method: "PATCH", params: { taskId: targetTaskId }, body: { expectedStatus: "NEW", toStatus: "IN_PROGRESS" } },
    ]

    expect(cases).toHaveLength(33)
    for (const testCase of cases) {
      const response = await invoke(
        testCase.handler,
        testCase.path,
        testCase.method,
        testCase.params,
        testCase.body,
      )
      expect(response.status, testCase.name).toBe(testCase.expected ?? 404)
    }

    const [product, route, visit, task, review, reference, slot, targetCounts] = await Promise.all([
      workerDb.product.findUniqueOrThrow({ where: { id: targetProductId } }),
      workerDb.route.findUniqueOrThrow({ where: { id: targetRouteId } }),
      workerDb.visit.findUniqueOrThrow({ where: { id: targetVisitId } }),
      workerDb.task.findUniqueOrThrow({ where: { id: targetTaskId } }),
      workerDb.humanReview.findUniqueOrThrow({ where: { id: targetReviewId } }),
      workerDb.goldenReference.findUniqueOrThrow({ where: { id: targetReferenceId } }),
      workerDb.goldenReferenceSlot.findUniqueOrThrow({ where: { id: targetSlotId } }),
      Promise.all([
        workerDb.planogramPlacement.count({ where: { planogramVersionId: targetVersionId } }),
        workerDb.planogramZone.count({ where: { planogramVersionId: targetVersionId } }),
        workerDb.planogramVersion.count({ where: { planogramId: targetPlanogramId } }),
        workerDb.floorPlan.count({ where: { organizationId: organizationB } }),
        workerDb.captureRetakeRequest.count({ where: { organizationId: organizationB } }),
      ]),
    ])
    expect(product.name).toBe("Target product")
    expect(route).toMatchObject({ name: "Target route", isActive: true })
    expect(visit).toMatchObject({ status: "IN_PROGRESS", checkOutAt: null })
    expect(task).toMatchObject({ status: "NEW", assigneeId: targetUserId })
    expect(review).toMatchObject({ status: "PENDING" })
    expect(reference).toMatchObject({ status: "ACTIVE" })
    expect(slot).toMatchObject({ label: "Target slot" })
    expect(targetCounts).toEqual([1, 1, 1, 1, 0])
  })
})
