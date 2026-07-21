import "dotenv/config"
import { randomUUID } from "node:crypto"
import { createSystemClient } from "@leadshelf/db"
import { iteratePlanogramProductRows, type ProductRow } from "./planogram-products"
import { createPlanogramProductsXmlStream } from "./planogram-products-export"

const CONFIRMATION = "yes-i-understand-local-only"

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`expected integer between ${min} and ${max}`)
  }
  return parsed
}

function configuration() {
  if (process.env.RUN_ANALYTICS_DB_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_ANALYTICS_DB_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("analytics DB benchmark refuses a non-loopback database")
  }
  return {
    rows: boundedInteger(process.env.ANALYTICS_DB_BENCHMARK_ROWS, 100_000, 1, 100_000),
    concurrency: boundedInteger(process.env.ANALYTICS_DB_BENCHMARK_CONCURRENCY, 2, 1, 4),
  }
}

async function consumeExport(rows: Iterable<ProductRow> | AsyncIterable<ProductRow>) {
  const reader = createPlanogramProductsXmlStream(rows).getReader()
  let bytes = 0
  let chunks = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    chunks += 1
  }
  return { bytes, chunks }
}

async function main() {
  const { rows: rowCount, concurrency } = configuration()
  const prisma = createSystemClient("local-analytics-db-capacity-benchmark")
  let organizationId: string | null = null

  try {
    const organization = await prisma.organization.create({
      data: { name: "Analytics DB Capacity", slug: `analytics-db-capacity-${Date.now()}` },
    })
    organizationId = organization.id
    const equipmentType = await prisma.equipmentType.create({
      data: { organizationId, name: "Capacity rack", kind: "rack" },
    })
    const equipmentTemplate = await prisma.equipmentTemplate.create({
      data: { organizationId, typeId: equipmentType.id, name: "Capacity equipment" },
    })
    const equipmentVersion = await prisma.equipmentVersion.create({
      data: { templateId: equipmentTemplate.id, versionNumber: 1, widthMm: 1200, heightMm: 1800, depthMm: 300 },
    })
    const planogram = await prisma.planogram.create({ data: { organizationId, name: "Capacity planogram" } })
    const planogramVersion = await prisma.planogramVersion.create({
      data: { planogramId: planogram.id, versionNumber: 1, state: "DRAFT" },
    })
    const planogramEquipment = await prisma.planogramEquipment.create({
      data: { planogramVersionId: planogramVersion.id, equipmentVersionId: equipmentVersion.id },
    })

    const fixtureStarted = performance.now()
    const productIds: string[] = []
    const chunkSize = 5_000
    for (let offset = 0; offset < rowCount; offset += chunkSize) {
      const size = Math.min(chunkSize, rowCount - offset)
      const products = Array.from({ length: size }, (_, chunkIndex) => {
        const index = offset + chunkIndex
        const id = randomUUID()
        productIds.push(id)
        return {
          id,
          organizationId: organization.id,
          sku: `ANALYTICS-${index.toString().padStart(6, "0")}`,
          name: `Analytics product ${index}`,
          widthMm: 40 + (index % 80),
          heightMm: 100,
          depthMm: 50,
        }
      })
      await prisma.product.createMany({ data: products })
    }
    for (let offset = 0; offset < rowCount; offset += chunkSize) {
      const size = Math.min(chunkSize, rowCount - offset)
      await prisma.planogramPlacement.createMany({
        data: Array.from({ length: size }, (_, chunkIndex) => {
          const index = offset + chunkIndex
          return {
            id: randomUUID(),
            planogramVersionId: planogramVersion.id,
            planogramEquipmentId: planogramEquipment.id,
            productId: productIds[index]!,
            xMm: index % 1_200,
            yMm: 0,
            widthMm: 40 + (index % 80),
            heightMm: 100,
            depthMm: 50,
            facingsX: 1 + (index % 3),
            sortOrder: index,
          }
        }),
      })
    }
    productIds.length = 0
    const fixtureDurationMs = performance.now() - fixtureStarted
    const rssBefore = process.memoryUsage().rss
    const exportStarted = performance.now()
    const singleExport = await consumeExport(iteratePlanogramProductRows(prisma, organization.id))
    const exportDurationMs = performance.now() - exportStarted
    if (singleExport.chunks !== rowCount + 2 || singleExport.bytes < rowCount * 100) {
      throw new Error("analytics DB benchmark single-export integrity failed")
    }

    const concurrentStarted = performance.now()
    const concurrentResults = await Promise.all(Array.from({ length: concurrency }, async () => {
      const output = await consumeExport(iteratePlanogramProductRows(prisma, organization.id))
      if (output.chunks !== rowCount + 2 || output.bytes !== singleExport.bytes) {
        throw new Error("analytics DB benchmark concurrent-export integrity failed")
      }
      return output
    }))
    const concurrentDurationMs = performance.now() - concurrentStarted

    console.log(JSON.stringify({
      rows: rowCount,
      concurrency,
      fixtureDurationMs: Math.round(fixtureDurationMs),
      exportDurationMs: Math.round(exportDurationMs),
      concurrentDurationMs: Math.round(concurrentDurationMs),
      bytesPerExport: singleExport.bytes,
      concurrentBytes: concurrentResults.reduce((sum, result) => sum + result.bytes, 0),
      rss: { beforeBytes: rssBefore, afterBytes: process.memoryUsage().rss },
    }))
  } finally {
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
