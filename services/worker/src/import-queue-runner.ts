import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processNextCatalogImportJob } from "./catalog-import/queue"
import { initErrorReporting, writeOperationalLog } from "./observability"
import { installShutdownHandlers, normalizePollMs, runPollingLoop } from "./runner-lifecycle"

initErrorReporting("import-queue")

const prisma = createSystemClient("import-worker")
const pollMs = normalizePollMs(process.env.LEADSHELF_IMPORT_QUEUE_POLL_MS, 5_000)
const once = process.argv.includes("--once")
const shutdown = installShutdownHandlers("import-worker")

async function tick(): Promise<boolean> {
  const result = await processNextCatalogImportJob(prisma)
  if (result) {
    writeOperationalLog("info", "import-worker", "job_completed", {
      jobId: result.jobId, batchId: result.batchId, status: result.status,
    })
    return true
  }
  return false
}

async function main() {
  if (once) {
    await tick()
    return
  }
  await runPollingLoop(tick, pollMs, shutdown.signal, {
    onTickError(error, context) {
      writeOperationalLog("warn", "import-worker", "tick_retry_scheduled", {
        reasonCode: error instanceof Error ? error.name : "unknown_error",
        retryAttempt: context.attempt,
        retryDelayMs: context.retryDelayMs,
      })
    },
  })
}

main()
  .catch((error) => {
    writeOperationalLog("error", "import-worker", "runner_failed", {
      reasonCode: error instanceof Error ? error.name : "unknown_error",
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
