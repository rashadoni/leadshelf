import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"

import {
  attachFullSyncApprovalToJob,
  FullSyncWorkflowError,
  readFullSyncAttachControlFile,
} from "./full-sync-workflow"
import { FullSyncApprovalIssueError } from "./full-sync-approval"

function parseArgs(args: string[]): { controlFile: string; tokenFile: string; secretFile: string } {
  const allowed = new Set(["--control-file", "--token-file", "--secret-file"])
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value || !allowed.has(key) || values.has(key)) throw new Error("arguments_invalid")
    values.set(key, value)
  }
  if (values.size !== allowed.size) throw new Error("arguments_invalid")
  return {
    controlFile: values.get("--control-file")!,
    tokenFile: values.get("--token-file")!,
    secretFile: values.get("--secret-file")!,
  }
}

async function main() {
  const prisma = createSystemClient("full-sync-approval-attach")
  try {
    const paths = parseArgs(process.argv.slice(2))
    const control = await readFullSyncAttachControlFile(paths.controlFile)
    await attachFullSyncApprovalToJob(prisma, { ...control, tokenFile: paths.tokenFile, secretFile: paths.secretFile })
    process.stdout.write('{"event":"full_sync_approval_attached"}\n')
  } catch (error) {
    const code = error instanceof FullSyncWorkflowError || error instanceof FullSyncApprovalIssueError
      ? error.code
      : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "full_sync_approval_attach_failed", code })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
