import "dotenv/config"
import { createSystemClient } from "../src/tenant-client.ts"
import { createTemplateWithVersion } from "../src/repos/equipment.ts"
import { addPlacement, createPlanogramFromTemplate, PlanogramRepoError } from "../src/repos/planogram.ts"
import { publishPlanogramVersion } from "../src/repos/publish.ts"

const CONFIRMATION = "yes-i-understand-local-only"
const STORE_COUNT = 500

function assertLocalDatabase() {
  if (process.env.RUN_PUBLISH_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_PUBLISH_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("publish benchmark refuses a non-loopback database")
  }
}

async function main() {
  assertLocalDatabase()
  const prisma = createSystemClient("local-publish-capacity-benchmark")
  try {
    const organization = await prisma.organization.create({
      data: { name: "Publish Capacity", slug: `publish-capacity-${Date.now()}` },
    })
    const format = await prisma.storeFormat.create({
      data: { organizationId: organization.id, name: "Capacity format" },
    })
    await prisma.store.createMany({
      data: Array.from({ length: STORE_COUNT }, (_, index) => ({
        organizationId: organization.id,
        formatId: format.id,
        name: `Capacity store ${index + 1}`,
        code: `CAP-${(index + 1).toString().padStart(4, "0")}`,
      })),
    })
    const equipmentType = await prisma.equipmentType.create({
      data: { organizationId: organization.id, name: "Capacity rack", kind: "rack" },
    })
    const template = await createTemplateWithVersion(prisma, organization.id, {
      name: "Capacity equipment",
      typeId: equipmentType.id,
      geometry: { widthMm: 1200, heightMm: 1800, depthMm: 300 },
      shelves: [{ shelfIndex: 0, yMm: 50, thicknessMm: 20, depthMm: 300 }],
    })
    const product = await prisma.product.create({
      data: {
        organizationId: organization.id,
        sku: "CAP-PUBLISH-SKU",
        name: "Capacity product",
        widthMm: 75,
        heightMm: 150,
        depthMm: 60,
      },
    })
    const planogram = await createPlanogramFromTemplate(prisma, organization.id, {
      name: "Capacity planogram",
      equipmentTemplateId: template.templateId,
    })
    const version = await prisma.planogramVersion.findUniqueOrThrow({
      where: { id: planogram.versionId },
      include: { equipment: { include: { equipmentVersion: { include: { shelves: true } } } } },
    })
    await addPlacement(prisma, organization.id, {
      planogramVersionId: planogram.versionId,
      expectedRevision: version.updatedAt.toISOString(),
      shelfId: version.equipment[0]!.equipmentVersion.shelves[0]!.id,
      productId: product.id,
      facingsX: 1,
      facingsY: 1,
      facingsZ: 1,
    })
    const publishRevision = await prisma.planogramVersion.findUniqueOrThrow({
      where: { id: planogram.versionId },
      select: { updatedAt: true },
    })

    const rssBefore = process.memoryUsage().rss
    const started = performance.now()
    const result = await publishPlanogramVersion(prisma, organization.id, {
      planogramId: planogram.planogramId,
      versionId: planogram.versionId,
      expectedRevision: publishRevision.updatedAt.toISOString(),
      target: { type: "FORMAT", formatId: format.id },
    })
    const durationMs = performance.now() - started
    const [tasks, histories, assignments] = await Promise.all([
      prisma.task.count({ where: { organizationId: organization.id } }),
      prisma.taskStatusHistory.count({
        where: { task: { organizationId: organization.id }, toStatus: "NEW" },
      }),
      prisma.planogramAssignment.count({
        where: { planogramVersion: { planogram: { organizationId: organization.id } } },
      }),
    ])

    let replayCode: string | null = null
    try {
      await publishPlanogramVersion(prisma, organization.id, {
        planogramId: planogram.planogramId,
        versionId: planogram.versionId,
        expectedRevision: publishRevision.updatedAt.toISOString(),
        target: { type: "FORMAT", formatId: format.id },
      })
    } catch (error) {
      replayCode = error instanceof PlanogramRepoError ? error.code : null
    }
    const [tasksAfterReplay, historiesAfterReplay, assignmentsAfterReplay] = await Promise.all([
      prisma.task.count({ where: { organizationId: organization.id } }),
      prisma.taskStatusHistory.count({ where: { task: { organizationId: organization.id } } }),
      prisma.planogramAssignment.count({
        where: { planogramVersion: { planogram: { organizationId: organization.id } } },
      }),
    ])
    const rssAfter = process.memoryUsage().rss

    if (
      result.resolvedStoreCount !== STORE_COUNT ||
      result.taskIds.length !== STORE_COUNT ||
      tasks !== STORE_COUNT ||
      histories !== STORE_COUNT ||
      assignments !== 1 ||
      replayCode !== "invalid_state" ||
      tasksAfterReplay !== tasks ||
      historiesAfterReplay !== histories ||
      assignmentsAfterReplay !== assignments
    ) {
      throw new Error("publish capacity integrity assertion failed")
    }

    console.log(JSON.stringify({
      stores: STORE_COUNT,
      durationMs: Math.round(durationMs),
      integrity: {
        tasks,
        histories,
        assignments,
        replayCode,
        tasksAfterReplay,
        historiesAfterReplay,
        assignmentsAfterReplay,
      },
      rss: { beforeBytes: rssBefore, afterBytes: rssAfter, deltaBytes: rssAfter - rssBefore },
    }))
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
