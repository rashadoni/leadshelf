import "dotenv/config"
import { readFile, stat } from "node:fs/promises"
import { createSystemClient, executeDsarExport, previewDsarExport } from "../src/index"

function values(args: string[], name: string): string[] {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1] as string] : [])
}
function value(args: string[], name: string) {
  return values(args, name)[0] ?? ""
}
async function encryptionKey(path: string): Promise<Buffer> {
  if (!path.trim()) throw new Error("[dsar] --encryption-key-file обязателен для execute")
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0) throw new Error("[dsar] key file должен иметь permissions 0600 или строже")
  const bytes = await readFile(path)
  const text = bytes.toString("utf8").trim()
  if (/^[a-f\d]{64}$/i.test(text)) return Buffer.from(text, "hex")
  if (bytes.length === 32) return bytes
  throw new Error("[dsar] key file должен содержать 32 raw bytes или 64 hex symbols")
}
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const base = {
    organizationId: value(args, "--organization-id"),
    slug: value(args, "--slug"),
    subjectUserId: value(args, "--subject-user-id"),
    requestId: value(args, "--request-id"),
  }
  const prisma = createSystemClient("controlled-dsar-export-cli")
  try {
    const result = command === "preview"
      ? await previewDsarExport(prisma, base)
      : command === "execute"
        ? await executeDsarExport(prisma, {
            ...base,
            confirmation: value(args, "--confirm"),
            approvals: values(args, "--approval"),
            legalBasisReceipt: value(args, "--legal-basis-receipt"),
            manifestDigest: value(args, "--manifest-digest"),
            outputPath: value(args, "--output"),
            encryptionKey: await encryptionKey(value(args, "--encryption-key-file")),
          })
        : (() => { throw new Error("usage: dsar <preview|execute> --organization-id ID --slug SLUG --subject-user-id ID --request-id ID") })()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
