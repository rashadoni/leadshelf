import "dotenv/config"
import { createSystemClient, executeRetention, previewRetention } from "../src/index"

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
            confirmation: value(args, "--confirm"),
            approvals: values(args, "--approval"),
            backupReceipt: value(args, "--backup-receipt"),
            mediaDeletionReceipt: value(args, "--media-deletion-receipt"),
            legalHoldCleared: args.includes("--legal-hold-cleared"),
            mediaManifestDigest: value(args, "--media-manifest-digest"),
          })
        : (() => {
            throw new Error("usage: retention <preview|execute> --organization-id ID --slug SLUG --as-of ISO --media-days N --gps-days N --audit-days N")
          })()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
