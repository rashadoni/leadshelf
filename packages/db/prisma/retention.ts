import "dotenv/config"
import { createSystemClient, executeRetention, previewRetention } from "../src/index"
import {
  safeRetentionExecuteOutput,
  safeRetentionFailureOutput,
  safeRetentionPreviewOutput,
} from "../src/retention-cli-output"

function values(args: string[], name: string): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) result.push(args[index + 1] as string)
  }
  return result
}
function value(args: string[], name: string) {
  return values(args, name)[0] ?? ""
}
function integer(args: string[], name: string) {
  const raw = value(args, name)
  return raw ? Number(raw) : Number.NaN
}
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const organizationId = value(args, "--organization-id")
  const slug = value(args, "--slug")
  const policy = {
    asOf: value(args, "--as-of"),
    mediaDays: integer(args, "--media-days"),
    gpsDays: integer(args, "--gps-days"),
    auditDays: integer(args, "--audit-days"),
  }
  const prisma = createSystemClient("controlled-retention-cli")
  try {
    const result = command === "preview"
      ? await previewRetention(prisma, { organizationId, slug, policy })
      : command === "execute"
        ? await executeRetention(prisma, {
            organizationId, slug, policy,
            changeId: value(args, "--change-id"),
            reasonCode: value(args, "--reason-code"),
            confirmation: value(args, "--confirm"),
            approvals: values(args, "--approval"),
            backupReceipt: value(args, "--backup-receipt"),
            mediaDeletionReceipt: value(args, "--media-deletion-receipt"),
            legalHoldClearanceReceipt: value(args, "--legal-hold-clearance-receipt"),
            legalHoldCleared: args.includes("--legal-hold-cleared"),
            mediaManifestDigest: value(args, "--media-manifest-digest"),
          })
        : (() => {
            throw new Error("usage: retention <preview|execute> --organization-id ID --slug SLUG --as-of ISO --media-days N --gps-days N --audit-days N")
          })()
    process.stdout.write(`${JSON.stringify(command === "preview"
      ? safeRetentionPreviewOutput(result as Awaited<ReturnType<typeof previewRetention>>)
      : safeRetentionExecuteOutput(result as Awaited<ReturnType<typeof executeRetention>>))}\n`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  void error
  process.stderr.write(`${JSON.stringify(safeRetentionFailureOutput())}\n`)
  process.exitCode = 1
})
