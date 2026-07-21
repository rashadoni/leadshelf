import { afterAll, describe, expect, it } from "vitest"
import {
  addPlacement,
  createPlanogramFromTemplate,
  createSystemClient,
  createTemplateWithVersion,
  decideHumanReview,
  publishPlanogramVersion,
  transitionTaskStatus,
} from "@leadshelf/db"
import { executeProductsImport } from "./catalog-import/execute-products-import"
import { executeSnapshotsImport } from "./catalog-import/execute-snapshots-import"
import { checksumImportRows } from "./catalog-import/reconciliation"

const prisma = createSystemClient("core-workflow-integration-test")
let organizationId: string | null = null

async function revision(versionId: string): Promise<string> {
  const version = await prisma.planogramVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: { updatedAt: true },
  })
  return version.updatedAt.toISOString()
}

afterAll(async () => {
  if (organizationId) {
    const inOrg = { organizationId }
    await prisma.notificationDelivery.deleteMany({ where: inOrg })
    await prisma.alert.deleteMany({ where: inOrg })
    await prisma.productEvent.deleteMany({ where: inOrg })
    await prisma.auditLog.deleteMany({ where: inOrg })
    await prisma.humanReview.deleteMany({ where: inOrg })
    await prisma.photoSubmission.deleteMany({ where: inOrg })
    await prisma.taskComment.deleteMany({ where: { user: { organizationId } } })
    await prisma.task.deleteMany({ where: inOrg })
    await prisma.planogramAssignment.deleteMany({
      where: { planogramVersion: { planogram: { organizationId } } },
    })
    await prisma.salesSnapshot.deleteMany({ where: inOrg })
    await prisma.stockSnapshot.deleteMany({ where: inOrg })
    await prisma.priceSnapshot.deleteMany({ where: inOrg })
    await prisma.storeAssortment.deleteMany({ where: { store: { organizationId } } })
    await prisma.assortmentMatrix.deleteMany({ where: { format: { organizationId } } })
    await prisma.externalIdMap.deleteMany({ where: inOrg })
    await prisma.importBatch.deleteMany({ where: inOrg })
    await prisma.planogramPlacement.deleteMany({
      where: { planogramVersion: { planogram: { organizationId } } },
    })
    await prisma.planogram.deleteMany({ where: inOrg })
    await prisma.organization.delete({ where: { id: organizationId } })
  }
  await prisma.$disconnect()
})

describe("isolated core product workflow", () => {
  it("runs ERP import through planogram, publish, proof review and analytics", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const organization = await prisma.organization.create({
      data: { name: "Core workflow fixture", slug: `core-workflow-${suffix}` },
    })
    organizationId = organization.id
    const [admin, fieldUser, format, equipmentType] = await Promise.all([
      prisma.user.create({
        data: { organizationId, name: "Workflow admin", role: "ADMIN", email: `admin-${suffix}@example.test` },
      }),
      prisma.user.create({
        data: { organizationId, name: "Workflow agent", role: "STORE_STAFF", employeeCode: `WF-${suffix}` },
      }),
      prisma.storeFormat.create({ data: { organizationId, name: "Workflow format" } }),
      prisma.equipmentType.create({ data: { organizationId, name: "Workflow rack", kind: "rack" } }),
    ])
    const store = await prisma.store.create({
      data: { organizationId, formatId: format.id, name: "Workflow store", code: `STORE-${suffix}` },
    })

    const productRows = [{
      sku: `SKU-${suffix}`,
      name: "Workflow product",
      barcode: "9900000000001",
      widthmm: "100",
      heightmm: "150",
      depthmm: "80",
    }]
    const productImport = await executeProductsImport(prisma, {
      organizationId,
      rows: productRows,
      expectedRows: 1,
      expectedChecksum: checksumImportRows(productRows),
    })
    expect(productImport).toMatchObject({ status: "COMPLETED", errorRows: 0 })
    expect(productImport.reconciliation.status).toBe("MATCH")
    const product = await prisma.product.findFirstOrThrow({ where: { organizationId, sku: productRows[0]!.sku } })

    const template = await createTemplateWithVersion(prisma, organizationId, {
      name: "Workflow shelf",
      typeId: equipmentType.id,
      geometry: { widthMm: 1200, heightMm: 1800, depthMm: 400 },
      shelves: [{ shelfIndex: 0, yMm: 100, thicknessMm: 20, depthMm: 400 }],
    })
    const planogram = await createPlanogramFromTemplate(prisma, organizationId, {
      name: "Workflow planogram",
      equipmentTemplateId: template.templateId,
      authorId: admin.id,
    })
    const editor = await prisma.planogramVersion.findUniqueOrThrow({
      where: { id: planogram.versionId },
      include: { equipment: { include: { equipmentVersion: { include: { shelves: true } } } } },
    })
    await addPlacement(prisma, organizationId, {
      planogramVersionId: planogram.versionId,
      expectedRevision: await revision(planogram.versionId),
      shelfId: editor.equipment[0]!.equipmentVersion.shelves[0]!.id,
      productId: product.id,
      facingsX: 3,
      facingsY: 1,
      facingsZ: 1,
    })

    const published = await publishPlanogramVersion(prisma, organizationId, {
      planogramId: planogram.planogramId,
      versionId: planogram.versionId,
      expectedRevision: await revision(planogram.versionId),
      target: { type: "STORES", storeIds: [store.id] },
      publishedById: admin.id,
    })
    expect(published).toMatchObject({ resolvedStoreCount: 1 })
    expect(published.taskIds).toHaveLength(1)
    const taskId = published.taskIds[0]!
    await prisma.task.update({ where: { id: taskId }, data: { assigneeId: fieldUser.id } })
    await transitionTaskStatus(prisma, organizationId, {
      taskId, expectedStatus: "NEW", toStatus: "IN_PROGRESS", byUserId: fieldUser.id,
    })

    const photo = await prisma.photoSubmission.create({
      data: {
        organizationId,
        storeId: store.id,
        taskId,
        userId: fieldUser.id,
        url: `photos/${organizationId}/${taskId}/workflow-proof.jpg`,
        clientPhotoId: `workflow-proof-${suffix}`,
        takenAt: new Date(),
      },
    })
    await transitionTaskStatus(prisma, organizationId, {
      taskId, expectedStatus: "IN_PROGRESS", toStatus: "PHOTO_SUBMITTED", byUserId: fieldUser.id,
    })
    const review = await prisma.humanReview.create({
      data: {
        organizationId,
        taskId,
        photoSubmissionId: photo.id,
        planogramVersionId: planogram.versionId,
        reason: "PHOTO_QUALITY",
        status: "PENDING",
      },
    })
    expect(await decideHumanReview(prisma, organizationId, {
      reviewId: review.id,
      status: "APPROVED",
      reviewedById: admin.id,
      note: "Automated isolated workflow acceptance",
    })).toMatchObject({ taskCompleted: true })

    const salesRows = [{
      sku: product.sku,
      storecode: store.code!,
      date: "2026-07-18",
      quantity: "3",
      revenue: "12.30",
      profit: "2.10",
    }]
    const salesImport = await executeSnapshotsImport(prisma, {
      organizationId,
      entityType: "sales",
      rows: salesRows,
      expectedRows: 1,
      expectedChecksum: checksumImportRows(salesRows),
      expectedTotals: { quantity: "3", revenue: "12.3", profit: "2.1" },
    })
    expect(salesImport).toMatchObject({ status: "COMPLETED", errorRows: 0 })
    expect(salesImport.reconciliation).toMatchObject({ status: "MATCH" })

    const [task, sales, assignments, history] = await Promise.all([
      prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
      prisma.salesSnapshot.aggregate({ where: { organizationId }, _sum: { quantity: true, revenue: true, profit: true } }),
      prisma.planogramAssignment.count({ where: { planogramVersionId: planogram.versionId } }),
      prisma.taskStatusHistory.count({ where: { taskId } }),
    ])
    expect(task).toMatchObject({ status: "COMPLETED", assigneeId: fieldUser.id })
    expect(assignments).toBe(1)
    expect(history).toBe(4)
    expect(sales._sum.quantity?.toString()).toBe("3")
    expect(sales._sum.revenue?.toString()).toBe("12.3")
    expect(sales._sum.profit?.toString()).toBe("2.1")
  })
})
