import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"

import {
  cancelPendingFullSyncJob,
  FullSyncCancelError,
  readFullSyncCancelControlFile,
} from "./full-sync-cancel"

function parseArgs(args: string[]): { controlFile: string } {
  if (args.length !== 2 || args[0] !== "--control-file" || !args[1]) throw new Error("arguments_invalid")
  return { controlFile: args[1] }
}

async function main() {
  const prisma = createSystemClient("full-sync-cancel")
  try {
    const paths = parseArgs(process.argv.slice(2))
    const control = await readFullSyncCancelControlFile(paths.controlFile)
    await cancelPendingFullSyncJob(prisma, control)
    process.stdout.write('{"event":"full_sync_cancelled"}\n')
  } catch (error) {
    const code = error instanceof FullSyncCancelError ? error.code : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "full_sync_cancel_failed", code })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
