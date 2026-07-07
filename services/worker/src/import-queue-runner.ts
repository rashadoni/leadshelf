import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processNextCatalogImportJob } from "./catalog-import/queue"
import { initErrorReporting } from "./observability"

initErrorReporting("import-queue")

const prisma = createSystemClient("import-worker")
const pollMs = Number(process.env.LEADSHELF_IMPORT_QUEUE_POLL_MS ?? 5000)
const once = process.argv.includes("--once")

async function tick(): Promise<boolean> {
  const result = await processNextCatalogImportJob(prisma)
  if (result) {
    console.log(`[import-worker] job=${result.jobId} batch=${result.batchId} status=${result.status}`)
    return true
  }
  return false
}

async function main() {
  if (once) {
    await tick()
    return
  }
  for (;;) {
    const processed = await tick()
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (once) await prisma.$disconnect()
  })
