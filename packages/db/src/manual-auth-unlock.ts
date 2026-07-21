import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  authenticationLockoutScope,
  mobileAuthenticationLockoutKey,
  webAuthenticationLockoutKey,
  type AuthenticationChannel,
} from "./auth-lockout.ts"
import { opaqueRateLimitKey } from "./rate-limit.ts"

export interface ManualAuthenticationUnlockPreviewInput {
  organizationId: string
  slug: string
  channel: AuthenticationChannel
  principal: string
  pepper: string
  now?: Date
}

export interface ManualAuthenticationUnlockPreview {
  organization: { id: string; slug: string }
  channel: AuthenticationChannel
  state: {
    exists: boolean
    locked: boolean
    failureCount: number
    lockedUntil: string | null
    updatedAt: string | null
  }
  stateDigest: string
  confirmation: string
}

export interface ExecuteManualAuthenticationUnlockInput
  extends ManualAuthenticationUnlockPreviewInput {
  enabled: boolean
  stateDigest: string
  confirmation: string
  approvals: string[]
  ticketId: string
  reasonCode: string
}

export interface ManualAuthenticationUnlockResult {
  auditEventId: string
  organizationId: string
  slug: string
  channel: AuthenticationChannel
  ticketId: string
  reasonCode: string
  previousState: ManualAuthenticationUnlockPreview["state"]
}

type Db = PrismaClient | Prisma.TransactionClient
type LockoutRow = {
  failureCount: number
  lockedUntil: Date | null
  updatedAt: Date
}

const SAFE_EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,127}$/
const SAFE_REASON = /^[a-z][a-z0-9._-]{2,63}$/

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`[auth-unlock] ${field} is required`)
  return normalized
}

function safeExternalId(value: string, field: string): string {
  const normalized = required(value, field)
  if (!SAFE_EXTERNAL_ID.test(normalized)) {
    throw new Error(`[auth-unlock] ${field} has an invalid format`)
  }
  return normalized
}

function normalizedPrincipal(channel: AuthenticationChannel, value: string): string {
  const normalized = required(value, "principal").toLowerCase()
  if (normalized.length > 320) throw new Error("[auth-unlock] principal has an invalid format")
  if (channel === "web" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("[auth-unlock] principal has an invalid format")
  }
  if (channel === "mobile" && !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
    throw new Error("[auth-unlock] principal has an invalid format")
  }
  return normalized
}

function principalKey(
  channel: AuthenticationChannel,
  slug: string,
  principal: string,
  pepper: string,
): string {
  return channel === "web"
    ? webAuthenticationLockoutKey(slug, principal, pepper)
    : mobileAuthenticationLockoutKey(slug, principal, pepper)
}

async function identity(
  db: Db,
  organizationId: string,
  slug: string,
  channel: AuthenticationChannel,
  principal: string,
): Promise<{ organization: { id: string; slug: string }; userId: string }> {
  const organization = await db.organization.findFirst({
    where: { id: organizationId, slug: { equals: slug, mode: "insensitive" } },
    select: { id: true, slug: true },
  })
  if (!organization) throw new Error("[auth-unlock] tenant/principal identity does not match")
  const user = await db.user.findFirst({
    where: {
      organizationId,
      isActive: true,
      ...(channel === "web"
        ? { email: { equals: principal, mode: "insensitive" as const } }
        : { employeeCode: { equals: principal, mode: "insensitive" as const } }),
    },
    select: { id: true },
  })
  if (!user) throw new Error("[auth-unlock] tenant/principal identity does not match")
  return { organization, userId: user.id }
}

function digest(input: {
  organizationId: string
  userId: string
  channel: AuthenticationChannel
  scope: string
  keyHash: string
  row: LockoutRow | null
}): string {
  return createHash("sha256").update(JSON.stringify({
    organizationId: input.organizationId,
    userId: input.userId,
    channel: input.channel,
    scope: input.scope,
    keyHash: input.keyHash,
    failureCount: input.row?.failureCount ?? 0,
    lockedUntil: input.row?.lockedUntil?.toISOString() ?? null,
    updatedAt: input.row?.updatedAt.toISOString() ?? null,
  })).digest("hex")
}

async function buildPreview(
  db: Db,
  input: ManualAuthenticationUnlockPreviewInput,
  lockRow: boolean,
): Promise<ManualAuthenticationUnlockPreview & { userId: string; scope: string; keyHash: string }> {
  const organizationId = required(input.organizationId, "organizationId")
  const slug = required(input.slug, "slug").toLowerCase()
  if (input.channel !== "web" && input.channel !== "mobile") {
    throw new Error("[auth-unlock] channel must be web or mobile")
  }
  const principal = normalizedPrincipal(input.channel, input.principal)
  const resolved = await identity(db, organizationId, slug, input.channel, principal)
  const scope = authenticationLockoutScope(input.channel)
  const keyHash = opaqueRateLimitKey([principalKey(input.channel, slug, principal, input.pepper)])
  const rows = await db.$queryRaw<LockoutRow[]>(Prisma.sql`
    SELECT "failureCount", "lockedUntil", "updatedAt"
    FROM "authentication_lockouts"
    WHERE "scope" = ${scope} AND "keyHash" = ${keyHash}
    LIMIT 1
    ${lockRow ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `)
  const row = rows[0] ?? null
  const now = input.now ?? new Date()
  const state = {
    exists: Boolean(row),
    locked: Boolean(row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()),
    failureCount: row?.failureCount ?? 0,
    lockedUntil: row?.lockedUntil?.toISOString() ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  }
  const stateDigest = digest({
    organizationId,
    userId: resolved.userId,
    channel: input.channel,
    scope,
    keyHash,
    row,
  })
  return {
    organization: resolved.organization,
    channel: input.channel,
    state,
    stateDigest,
    confirmation: `UNLOCK ${slug} ${organizationId} ${input.channel} ${stateDigest}`,
    userId: resolved.userId,
    scope,
    keyHash,
  }
}

export async function previewManualAuthenticationUnlock(
  prisma: PrismaClient,
  input: ManualAuthenticationUnlockPreviewInput,
): Promise<ManualAuthenticationUnlockPreview> {
  const { userId: _userId, scope: _scope, keyHash: _keyHash, ...preview } =
    await buildPreview(prisma, input, false)
  return preview
}

export async function executeManualAuthenticationUnlock(
  prisma: PrismaClient,
  input: ExecuteManualAuthenticationUnlockInput,
): Promise<ManualAuthenticationUnlockResult> {
  if (!input.enabled) {
    throw new Error("[auth-unlock] manual unlock is disabled; approved runtime flag is required")
  }
  const approvals = [...new Set(input.approvals.map((value) => safeExternalId(value, "approval ID")))]
  if (approvals.length < 2) throw new Error("[auth-unlock] two distinct approval IDs are required")
  const ticketId = safeExternalId(input.ticketId, "ticketId")
  const reasonCode = required(input.reasonCode, "reasonCode").toLowerCase()
  if (!SAFE_REASON.test(reasonCode)) throw new Error("[auth-unlock] reasonCode has an invalid format")

  return prisma.$transaction(async (tx) => {
    const organizationId = required(input.organizationId, "organizationId")
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 4))
    `)
    const preview = await buildPreview(tx, input, true)
    if (required(input.stateDigest, "stateDigest") !== preview.stateDigest) {
      throw new Error("[auth-unlock] lockout state changed; repeat preview")
    }
    if (input.confirmation !== preview.confirmation) {
      throw new Error("[auth-unlock] confirmation does not match the current preview")
    }
    if (!preview.state.exists || !preview.state.locked) {
      throw new Error("[auth-unlock] principal is not currently locked")
    }
    const removed = await tx.authenticationLockout.deleteMany({
      where: { scope: preview.scope, keyHash: preview.keyHash },
    })
    if (removed.count !== 1) throw new Error("[auth-unlock] lockout state changed; repeat preview")
    const remaining = await tx.authenticationLockout.count({
      where: { scope: preview.scope, keyHash: preview.keyHash },
    })
    if (remaining !== 0) throw new Error("[auth-unlock] recovery verification failed")
    const audit = await tx.auditLog.create({
      data: {
        organizationId,
        action: "authentication.manual_unlock",
        entityType: "user",
        entityId: preview.userId,
        payload: {
          channel: input.channel,
          ticketId,
          reasonCode,
          approvalIds: approvals,
          stateDigest: preview.stateDigest,
          previousState: preview.state,
        } as unknown as Prisma.InputJsonObject,
      },
    })
    return {
      auditEventId: audit.id,
      organizationId,
      slug: preview.organization.slug,
      channel: input.channel,
      ticketId,
      reasonCode,
      previousState: preview.state,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
