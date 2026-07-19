import { issueDestructiveFullSyncApprovalFromFiles, FullSyncApprovalIssueError } from "./full-sync-approval"

function parseArgs(args: string[]): { requestFile: string; secretFile: string; outputFile: string } {
  const allowed = new Set(["--request-file", "--secret-file", "--output-file"])
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value || !allowed.has(key) || values.has(key)) throw new Error("arguments_invalid")
    values.set(key, value)
  }
  if (values.size !== allowed.size) throw new Error("arguments_invalid")
  return {
    requestFile: values.get("--request-file")!,
    secretFile: values.get("--secret-file")!,
    outputFile: values.get("--output-file")!,
  }
}

async function main() {
  try {
    const paths = parseArgs(process.argv.slice(2))
    await issueDestructiveFullSyncApprovalFromFiles(paths)
    process.stdout.write('{"event":"full_sync_approval_written"}\n')
  } catch (error) {
    const code = error instanceof FullSyncApprovalIssueError ? error.code : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "full_sync_approval_failed", code })}\n`)
    process.exitCode = 1
  }
}

void main()
