import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processPendingNotificationsForAllOrganizations } from "./notifications/push"

const prisma = createSystemClient("notification-delivery-worker")
const pollMs = Number(process.env.LEADSHELF_NOTIFICATION_POLL_MS ?? 5000)
const once = process.argv.includes("--once")
const limitPerOrg = Number(process.env.LEADSHELF_NOTIFICATION_LIMIT_PER_ORG ?? 100)

async function tick(): Promise<boolean> {
  const result = await processPendingNotificationsForAllOrganizations(prisma, { limitPerOrg })
  if (result.claimed > 0) {
    console.log(
      `[notification-worker] organizations=${result.organizations} claimed=${result.claimed} sent=${result.sent} failed=${result.failed}`,
    )
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
