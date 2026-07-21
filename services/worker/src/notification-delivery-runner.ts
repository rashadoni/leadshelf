import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processPendingNotificationsForAllOrganizations } from "./notifications/push"
import { initErrorReporting, writeOperationalLog } from "./observability"
import { installShutdownHandlers, normalizePollMs, runPollingLoop } from "./runner-lifecycle"

initErrorReporting("notifications")

const prisma = createSystemClient("notification-delivery-worker")
const pollMs = normalizePollMs(process.env.LEADSHELF_NOTIFICATION_POLL_MS, 5_000)
const once = process.argv.includes("--once")
const limitPerOrg = Number(process.env.LEADSHELF_NOTIFICATION_LIMIT_PER_ORG ?? 100)
const shutdown = installShutdownHandlers("notification-worker")

async function tick(): Promise<boolean> {
  const result = await processPendingNotificationsForAllOrganizations(prisma, { limitPerOrg })
  if (result.claimed > 0) {
    writeOperationalLog("info", "notification-worker", "delivery_batch_completed", {
      organizations: result.organizations,
      claimed: result.claimed,
      sent: result.sent,
      retried: result.retried,
      failed: result.failed,
      status: result.failed > 0 ? "partial_failure" : "completed",
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
      writeOperationalLog("warn", "notification-worker", "tick_retry_scheduled", {
        reasonCode: error instanceof Error ? error.name : "unknown_error",
        retryAttempt: context.attempt,
        retryDelayMs: context.retryDelayMs,
      })
    },
  })
}

main()
  .catch((error) => {
    writeOperationalLog("error", "notification-worker", "runner_failed", {
      reasonCode: error instanceof Error ? error.name : "unknown_error",
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
