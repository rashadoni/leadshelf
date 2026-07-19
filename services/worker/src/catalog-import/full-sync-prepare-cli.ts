import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"

import { FullSyncApprovalIssueError } from "./full-sync-approval"
import { FullSyncWorkflowError, prepareFullSyncApprovalRequest } from "./full-sync-workflow"

function parseArgs(args: string[]): { controlFile: string; outputFile: string } {
  const allowed = new Set(["--control-file", "--output-file"])
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value || !allowed.has(key) || values.has(key)) throw new Error("arguments_invalid")
    values.set(key, value)
  }
  if (values.size !== allowed.size) throw new Error("arguments_invalid")
  return { controlFile: values.get("--control-file")!, outputFile: values.get("--output-file")! }
}

async function main() {
  const prisma = createSystemClient("full-sync-approval-prepare")
  try {
    await prepareFullSyncApprovalRequest(prisma, parseArgs(process.argv.slice(2)))
    process.stdout.write('{"event":"full_sync_approval_request_written"}\n')
  } catch (error) {
    const code = error instanceof FullSyncWorkflowError || error instanceof FullSyncApprovalIssueError
      ? error.code
      : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "full_sync_approval_request_failed", code })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
