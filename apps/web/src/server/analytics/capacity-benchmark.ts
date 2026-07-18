import type { ProductRow } from "./planogram-products"
import { createPlanogramProductsXmlStream } from "./planogram-products-export"

const CONFIRMATION = "yes-i-understand-local-only"
const ROWS = 100_000

async function main() {
  if (process.env.RUN_ANALYTICS_BENCHMARK !== CONFIRMATION) {
    throw new Error(`RUN_ANALYTICS_BENCHMARK must equal ${CONFIRMATION}`)
  }
  const rows: ProductRow[] = Array.from({ length: ROWS }, (_, index) => ({
    key: `v:${index}`, productId: `p-${index}`, planogramId: `plan-${index % 500}`,
    versionId: `v-${index % 500}`, planogramName: `Capacity planogram ${index % 500}`,
    versionNumber: 1, state: "PUBLISHED", sku: `CAP-${index.toString().padStart(6, "0")}`,
    productName: `Capacity product ${index}`, brand: `Brand ${index % 100}`,
    category: `Category ${index % 50}`, supplier: `Supplier ${index % 20}`,
    placements: 1, units: 1 + (index % 12), linearMm: 40 + (index % 80),
  }))
  const rssBefore = process.memoryUsage().rss
  const started = performance.now()
  const reader = createPlanogramProductsXmlStream(rows).getReader()
  let bytes = 0
  let chunks = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    chunks++
  }
  const durationMs = performance.now() - started
  if (chunks !== ROWS + 2 || bytes < 10_000_000) throw new Error("analytics stream integrity failed")
  console.log(JSON.stringify({ rows: ROWS, chunks, bytes, durationMs: Math.round(durationMs),
    rowsPerSecond: Math.round(ROWS * 1000 / durationMs),
    rss: { beforeBytes: rssBefore, afterBytes: process.memoryUsage().rss } }))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
