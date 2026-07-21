import "dotenv/config"
import { createHash, randomUUID } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { createSystemClient } from "@leadshelf/db"
import { signAccessToken } from "../auth/jwt"

const CONFIRMATION = "yes-i-understand-local-only"
const PREFIX = "LOAD-DISTINCT-"

function assertLocalDatabase() {
  if (process.env.RUN_DISTINCT_USER_FIXTURE !== CONFIRMATION) {
    throw new Error(`RUN_DISTINCT_USER_FIXTURE must equal ${CONFIRMATION}`)
  }
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required")
  const url = new URL(raw)
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("distinct-user fixture refuses a non-loopback database")
  }
}

async function cleanup(prisma: ReturnType<typeof createSystemClient>, organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, employeeCode: { startsWith: PREFIX } },
    select: { id: true },
  })
  const userIds = users.map((user) => user.id)
  const devices = userIds.length > 0
    ? await prisma.mobileDevice.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
    : []
  const deviceIds = devices.map((device) => device.id)
  // consumeDurableRateLimit hashes the already opaque device id once.
  const rateLimitKeyHashes = deviceIds.map((id) => createHash("sha256").update(id).digest("hex"))
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { organizationId, title: { startsWith: PREFIX } } }),
    ...(deviceIds.length > 0
      ? [prisma.rateLimitBucket.deleteMany({
          where: {
            scope: "mobile-sync",
            keyHash: { in: rateLimitKeyHashes },
          },
        })]
      : []),
    prisma.mobileDevice.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ])
  return { users: userIds.length, devices: deviceIds.length }
}

async function main() {
  assertLocalDatabase()
  const prisma = createSystemClient("distinct-user-load-fixture")
  try {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "demo" } })
    const cleaned = await cleanup(prisma, organization.id)
    if (process.argv.includes("--cleanup")) {
      await unlink(process.env.DISTINCT_USER_TOKEN_FILE ?? "/tmp/leadshelf-distinct-user-tokens.csv").catch(() => undefined)
      console.log(JSON.stringify({ mode: "cleanup", ...cleaned }))
      return
    }
    const count = Number(process.env.DISTINCT_USER_COUNT ?? 200)
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new Error("DISTINCT_USER_COUNT must be an integer between 1 and 500")
    }
    const store = await prisma.store.findFirstOrThrow({ where: { organizationId: organization.id, isActive: true } })
    const users = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      organizationId: organization.id,
      name: `Load user ${index + 1}`,
      employeeCode: `${PREFIX}${(index + 1).toString().padStart(4, "0")}`,
      role: "FIELD_AGENT" as const,
    }))
    const devices = users.map((user, index) => ({
      id: randomUUID(),
      userId: user.id,
      platform: index % 2 === 0 ? "android" : "ios",
      deviceName: `${PREFIX}${(index + 1).toString().padStart(4, "0")}`,
    }))
    await prisma.$transaction([
      prisma.user.createMany({ data: users }),
      prisma.mobileDevice.createMany({ data: devices }),
      prisma.task.createMany({
        data: users.map((user, index) => ({
          organizationId: organization.id,
          storeId: store.id,
          assigneeId: user.id,
          title: `${PREFIX}${(index + 1).toString().padStart(4, "0")}`,
        })),
      }),
    ])
    const tokens = await Promise.all(users.map((user, index) => signAccessToken({
      sub: user.id,
      org: organization.id,
      role: user.role,
      sid: randomUUID(),
      did: devices[index]!.id,
    })))
    const tokenFile = process.env.DISTINCT_USER_TOKEN_FILE ?? "/tmp/leadshelf-distinct-user-tokens.csv"
    await writeFile(tokenFile, tokens.join(","), { mode: 0o600 })
    console.log(JSON.stringify({ mode: "prepare", users: count, devices: count, tasks: count, tokenFile }))
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
