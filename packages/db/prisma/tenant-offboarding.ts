import "dotenv/config"
import { createSystemClient, deleteTenantData, previewTenantOffboarding } from "../src/index"

function values(args: string[], name: string): string[] {
  const found: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) found.push(args[index + 1] as string)
  }
  return found
}

function value(args: string[], name: string): string {
  return values(args, name)[0] ?? ""
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const organizationId = value(args, "--organization-id")
  const slug = value(args, "--slug")
  const prisma = createSystemClient("controlled-tenant-offboarding-cli")
  try {
    const result = command === "preview"
      ? await previewTenantOffboarding(prisma, { organizationId, slug })
      : command === "execute"
        ? await deleteTenantData(prisma, {
            organizationId,
            slug,
            confirmation: value(args, "--confirm"),
            approvals: values(args, "--approval"),
            backupReceipt: value(args, "--backup-receipt"),
            mediaDeletionReceipt: value(args, "--media-deletion-receipt"),
            legalHoldCleared: args.includes("--legal-hold-cleared"),
          })
        : (() => { throw new Error("usage: tenant:offboarding <preview|execute> --organization-id ID --slug SLUG") })()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
