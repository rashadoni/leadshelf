// Одноразовая заливка демо-плейсхолдеров в бакет. В БД НИЧЕГО не пишет —
// поэтому её можно гонять там, где seed-demo запрещён (client production,
// deploy/OPERATIONS_RUNBOOK.md).
//
// Запуск:
//   pnpm --filter @leadshelf/db media:backfill                       # отчёт
//   pnpm --filter @leadshelf/db media:backfill --apply               # запись
//   pnpm --filter @leadshelf/db media:backfill --organization-id ID  # один тенант
import "dotenv/config"
import { createSystemClient } from "../src/index.ts"
import { backfillDemoProductImages } from "../src/demo-media-store.ts"

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes("--apply")
  const organizationId = value(args, "--organization-id")
  const prisma = createSystemClient("demo-media-backfill")
  try {
    const result = await backfillDemoProductImages({ prisma, organizationId, apply })
    process.stdout.write(`${JSON.stringify({
      event: apply ? "demo_media_backfill_applied" : "demo_media_backfill_preview",
      ...result,
    })}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    event: "demo_media_backfill_failed",
    message: error instanceof Error ? error.message : "unknown",
  })}\n`)
  process.exitCode = 1
})
