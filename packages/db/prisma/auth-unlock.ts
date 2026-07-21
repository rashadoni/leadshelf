import "dotenv/config"
import {
  createSystemClient,
  executeManualAuthenticationUnlock,
  previewManualAuthenticationUnlock,
  readManualAuthUnlockRequestFile,
  type AuthenticationChannel,
} from "../src/index"

function value(args: string[], name: string): string {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? "" : ""
}

function stringField(request: Record<string, unknown>, name: string): string {
  return typeof request[name] === "string" ? request[name] : ""
}

function approvals(request: Record<string, unknown>): string[] {
  if (!Array.isArray(request.approvals) || request.approvals.some((value) => typeof value !== "string")) {
    throw new Error("[auth-unlock] approvals must be an array of strings")
  }
  return request.approvals as string[]
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  if (command !== "preview" && command !== "execute") {
    throw new Error("usage: auth:unlock <preview|execute> --request-file /secure/path/request.json")
  }
  const request = await readManualAuthUnlockRequestFile(value(args, "--request-file"))
  const base = {
    organizationId: stringField(request, "organizationId"),
    slug: stringField(request, "slug"),
    channel: stringField(request, "channel") as AuthenticationChannel,
    principal: stringField(request, "principal"),
    pepper: process.env.AUTH_LOCKOUT_PEPPER ?? "",
  }
  const prisma = createSystemClient("controlled-authentication-unlock-cli")
  try {
    const result = command === "preview"
      ? await previewManualAuthenticationUnlock(prisma, base)
      : await executeManualAuthenticationUnlock(prisma, {
          ...base,
          enabled: process.env.AUTH_LOCKOUT_MANUAL_UNLOCK_ENABLED === "true",
          stateDigest: stringField(request, "stateDigest"),
          confirmation: stringField(request, "confirmation"),
          approvals: approvals(request),
          ticketId: stringField(request, "ticketId"),
          reasonCode: stringField(request, "reasonCode"),
        })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "[auth-unlock] operation failed")
  process.exitCode = 1
})
