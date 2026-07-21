import "dotenv/config"
import { createSystemClient } from "../src/tenant-client.ts"
import { createTemplateWithVersion } from "../src/repos/equipment.ts"
import { addPlacement, createPlanogramFromTemplate, PlanogramRepoError } from "../src/repos/planogram.ts"
import { publishPlanogramVersion } from "../src/repos/publish.ts"

const CONFIRMATION = "yes-i-understand-local-only"

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`expected integer between ${min} and ${max}`)
  }
  return parsed
}

function configuration() {
  if (process.env.RUN_PUBLISH_CONCURRENCY_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_PUBLISH_CONCURRENCY_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("publish concurrency benchmark refuses a non-loopback database")
  }
  return {
    tenants: boundedInteger(process.env.PUBLISH_BENCHMARK_TENANTS, 4, 2, 10),
    storesPerTenant: boundedInteger(process.env.PUBLISH_BENCHMARK_STORES_PER_TENANT, 100, 1, 500),
  }
}

type Fixture = {
  organizationId: string
  planogramId: string
  versionId: string
  revision: string
  formatId: string
}

async function createFixture(
  prisma: ReturnType<typeof createSystemClient>,
  index: number,
  storesPerTenant: number,
): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: { name: `Concurrent publish ${index}`, slug: `publish-concurrent-${Date.now()}-${index}` },
  })
  const format = await prisma.storeFormat.create({
    data: { organizationId: organization.id, name: "Capacity format" },
  })
  await prisma.store.createMany({
    data: Array.from({ length: storesPerTenant }, (_, storeIndex) => ({
      organizationId: organization.id,
      formatId: format.id,
      name: `Tenant ${index} store ${storeIndex + 1}`,
      code: `CAP-${(storeIndex + 1).toString().padStart(4, "0")}`,
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
  const revision = await prisma.planogramVersion.findUniqueOrThrow({
    where: { id: planogram.versionId },
    select: { updatedAt: true },
  })
  return {
    organizationId: organization.id,
    planogramId: planogram.planogramId,
    versionId: planogram.versionId,
    revision: revision.updatedAt.toISOString(),
    formatId: format.id,
  }
}

async function main() {
  const { tenants, storesPerTenant } = configuration()
  const prisma = createSystemClient("local-publish-concurrency-capacity")
  const organizationIds: string[] = []
  try {
    const fixtures: Fixture[] = []
    for (let index = 0; index < tenants; index++) {
      const fixture = await createFixture(prisma, index, storesPerTenant)
      fixtures.push(fixture)
      organizationIds.push(fixture.organizationId)
    }

    const rssBefore = process.memoryUsage().rss
    const started = performance.now()
    const results = await Promise.all(fixtures.map((fixture) => publishPlanogramVersion(prisma, fixture.organizationId, {
      planogramId: fixture.planogramId,
      versionId: fixture.versionId,
      expectedRevision: fixture.revision,
      target: { type: "FORMAT", formatId: fixture.formatId },
    })))
    const durationMs = performance.now() - started

    const integrity = await Promise.all(fixtures.map(async (fixture, index) => {
      const [tasks, histories, assignments, foreignTasks] = await Promise.all([
        prisma.task.count({ where: { organizationId: fixture.organizationId } }),
        prisma.taskStatusHistory.count({ where: { task: { organizationId: fixture.organizationId }, toStatus: "NEW" } }),
        prisma.planogramAssignment.count({ where: { planogramVersionId: fixture.versionId } }),
        prisma.task.count({
          where: {
            organizationId: fixture.organizationId,
            planogramVersionId: { in: fixtures.filter((_, other) => other !== index).map((item) => item.versionId) },
          },
        }),
      ])
      let replayCode: string | null = null
      try {
        await publishPlanogramVersion(prisma, fixture.organizationId, {
          planogramId: fixture.planogramId,
          versionId: fixture.versionId,
          expectedRevision: fixture.revision,
          target: { type: "FORMAT", formatId: fixture.formatId },
        })
      } catch (error) {
        replayCode = error instanceof PlanogramRepoError ? error.code : null
      }
      return { tasks, histories, assignments, foreignTasks, replayCode, resolved: results[index]!.resolvedStoreCount }
    }))

    if (integrity.some((row) =>
      row.tasks !== storesPerTenant ||
      row.histories !== storesPerTenant ||
      row.assignments !== 1 ||
      row.foreignTasks !== 0 ||
      row.replayCode !== "invalid_state" ||
      row.resolved !== storesPerTenant
    )) {
      throw new Error("publish concurrency benchmark integrity assertion failed")
    }
    console.log(JSON.stringify({
      tenants,
      storesPerTenant,
      totalTasks: tenants * storesPerTenant,
      durationMs: Math.round(durationMs),
      integrity,
      rss: { beforeBytes: rssBefore, afterBytes: process.memoryUsage().rss },
    }))
  } finally {
    for (const organizationId of organizationIds) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
