import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { Prisma, type PrismaClient } from "@leadshelf/prisma-client"

const SECRET_FIELD = /(password|secret|credential|token|jti|refresh|authorization|apikey|pin|session(id|key))/i

export interface DsarInventoryInput {
  organizationId: string
  slug: string
  subjectUserId: string
  requestId: string
}

export interface DsarPreview {
  organizationId: string
  slug: string
  categories: Record<string, number>
  recordCount: number
  manifestDigest: string
}

export interface ExecuteDsarExportInput extends DsarInventoryInput {
  confirmation: string
  approvals: string[]
  legalBasisReceipt: string
  manifestDigest: string
  outputPath: string
  encryptionKey: Buffer
}

export interface DsarExportResult extends DsarPreview {
  auditEventId: string
  artifactDigest: string
  encryption: "AES-256-GCM"
}

type Db = PrismaClient | Prisma.TransactionClient
type ExportRecords = Record<string, unknown[]>

function required(value: string, field: string): string {
  const result = value.trim()
  if (!result) throw new Error(`[dsar] ${field} обязателен`)
  return result
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets)
  if (!value || typeof value !== "object" || value instanceof Date) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELD.test(key.replaceAll("_", "")))
    .map(([key, child]) => [key, scrubSecrets(child)]))
}

function stableJson(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort)
    if (!input || typeof input !== "object" || input instanceof Date) return input
    if ("toJSON" in input && typeof input.toJSON === "function") return sort(input.toJSON())
    return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]))
  }
  return JSON.stringify(sort(value))
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

async function organizationAndSubject(db: Db, input: DsarInventoryInput) {
  const organization = await db.organization.findFirst({
    where: { id: input.organizationId, slug: input.slug },
    select: { id: true, slug: true },
  })
  if (!organization) throw new Error("[dsar] organizationId/slug не совпадают")
  const subject = await db.user.findFirst({ where: { id: input.subjectUserId, organizationId: input.organizationId } })
  if (!subject) throw new Error("[dsar] subjectUserId не принадлежит организации")
  return subject
}

async function collectRecords(db: Db, input: DsarInventoryInput): Promise<ExportRecords> {
  const subject = await organizationAndSubject(db, input)
  const agent = await db.fieldAgent.findFirst({ where: { organizationId: input.organizationId, userId: input.subjectUserId } })
  const agentId = agent?.id
  const devices = await db.mobileDevice.findMany({ where: { userId: input.subjectUserId }, orderBy: { id: "asc" } })
  const deviceIds = devices.map(({ id }) => id)
  const account = agentId ? await db.rewardAccount.findFirst({ where: { organizationId: input.organizationId, agentId } }) : null
  const accountId = account?.id

  const records: ExportRecords = {
    user: [subject],
    federatedIdentities: await db.federatedIdentity.findMany({ where: { organizationId: input.organizationId, userId: input.subjectUserId }, orderBy: { id: "asc" } }),
    authSessions: await db.authSession.findMany({ where: { organizationId: input.organizationId, userId: input.subjectUserId }, orderBy: { id: "asc" } }),
    mobileDevices: devices,
    syncCursors: deviceIds.length ? await db.syncCursor.findMany({ where: { deviceId: { in: deviceIds } }, orderBy: { id: "asc" } }) : [],
    syncConflicts: deviceIds.length ? await db.syncConflict.findMany({ where: { deviceId: { in: deviceIds } }, orderBy: { id: "asc" } }) : [],
    outboxOperations: deviceIds.length ? await db.outboxOperation.findMany({ where: { deviceId: { in: deviceIds } }, orderBy: { id: "asc" } }) : [],
    notificationDeliveries: deviceIds.length ? await db.notificationDelivery.findMany({ where: { organizationId: input.organizationId, deviceId: { in: deviceIds } }, orderBy: { id: "asc" } }) : [],
    fieldAgent: agent ? [agent] : [],
    ledTeams: await db.team.findMany({ where: { organizationId: input.organizationId, leadUserId: input.subjectUserId }, orderBy: { id: "asc" } }),
    assignedTasks: await db.task.findMany({ where: { organizationId: input.organizationId, assigneeId: input.subjectUserId }, orderBy: { id: "asc" } }),
    taskStatusHistory: await db.taskStatusHistory.findMany({ where: { byUserId: input.subjectUserId, task: { organizationId: input.organizationId } }, orderBy: { id: "asc" } }),
    taskComments: await db.taskComment.findMany({ where: { userId: input.subjectUserId, task: { organizationId: input.organizationId } }, orderBy: { id: "asc" } }),
    photoSubmissions: await db.photoSubmission.findMany({ where: { organizationId: input.organizationId, userId: input.subjectUserId }, orderBy: { id: "asc" } }),
    captureStepExceptions: await db.captureStepException.findMany({ where: { organizationId: input.organizationId, userId: input.subjectUserId }, orderBy: { id: "asc" } }),
    captureRetakeRequests: await db.captureRetakeRequest.findMany({ where: { organizationId: input.organizationId, requestedById: input.subjectUserId }, orderBy: { id: "asc" } }),
    auditLogs: await db.auditLog.findMany({ where: { organizationId: input.organizationId, userId: input.subjectUserId }, orderBy: { id: "asc" } }),
    importBatches: await db.importBatch.findMany({ where: { organizationId: input.organizationId, createdById: input.subjectUserId }, orderBy: { id: "asc" } }),
    importQueueJobs: await db.importQueueJob.findMany({ where: { organizationId: input.organizationId, createdById: input.subjectUserId }, orderBy: { id: "asc" } }),
    planogramVersions: await db.planogramVersion.findMany({ where: { planogram: { organizationId: input.organizationId }, OR: [{ authorId: input.subjectUserId }, { publishedById: input.subjectUserId }] }, orderBy: { id: "asc" } }),
    goldenReferences: await db.goldenReference.findMany({ where: { organizationId: input.organizationId, createdById: input.subjectUserId }, orderBy: { id: "asc" } }),
    humanReviews: await db.humanReview.findMany({ where: { organizationId: input.organizationId, reviewedById: input.subjectUserId }, orderBy: { id: "asc" } }),
    equipmentInspections: await db.equipmentInspection.findMany({ where: { byUserId: input.subjectUserId, asset: { organizationId: input.organizationId } }, orderBy: { id: "asc" } }),
    repairRequests: await db.repairRequest.findMany({ where: { reportedById: input.subjectUserId, asset: { organizationId: input.organizationId } }, orderBy: { id: "asc" } }),
    routes: agentId ? await db.route.findMany({ where: { organizationId: input.organizationId, agentId }, orderBy: { id: "asc" } }) : [],
    visits: agentId ? await db.visit.findMany({ where: { organizationId: input.organizationId, agentId }, orderBy: { id: "asc" } }) : [],
    agentLocations: agentId ? await db.agentLocation.findMany({ where: { agentId }, orderBy: { id: "asc" } }) : [],
    orders: agentId ? await db.order.findMany({ where: { organizationId: input.organizationId, agentId }, include: { lines: true }, orderBy: { id: "asc" } }) : [],
    promotionExecutions: await db.promotionExecution.findMany({ where: { organizationId: input.organizationId, OR: [{ agentId }, { decidedById: input.subjectUserId }].filter((entry) => Object.values(entry).every(Boolean)) }, orderBy: { id: "asc" } }),
    promoInventoryEvents: agentId ? await db.promoInventoryEvent.findMany({ where: { organizationId: input.organizationId, agentId }, orderBy: { id: "asc" } }) : [],
    salesReturns: await db.salesReturn.findMany({ where: { organizationId: input.organizationId, OR: [{ agentId }, { decidedById: input.subjectUserId }].filter((entry) => Object.values(entry).every(Boolean)) }, include: { lines: true }, orderBy: { id: "asc" } }),
    rewardAccounts: account ? [account] : [],
    rewardLedgerEntries: accountId ? await db.rewardLedgerEntry.findMany({ where: { organizationId: input.organizationId, accountId }, orderBy: { id: "asc" } }) : [],
    rewardClaims: await db.rewardClaim.findMany({ where: { organizationId: input.organizationId, OR: [{ accountId }, { decidedById: input.subjectUserId }].filter((entry) => Object.values(entry).every(Boolean)) }, orderBy: { id: "asc" } }),
  }
  return scrubSecrets(records) as ExportRecords
}

function previewFor(input: DsarInventoryInput, records: ExportRecords): DsarPreview {
  const categories = Object.fromEntries(Object.entries(records).map(([key, rows]) => [key, rows.length]))
  return {
    organizationId: input.organizationId,
    slug: input.slug,
    categories,
    recordCount: Object.values(categories).reduce((sum, count) => sum + count, 0),
    manifestDigest: sha256(stableJson(records)),
  }
}

function normalized(input: DsarInventoryInput): DsarInventoryInput {
  return {
    organizationId: required(input.organizationId, "organizationId"),
    slug: required(input.slug, "slug"),
    subjectUserId: required(input.subjectUserId, "subjectUserId"),
    requestId: required(input.requestId, "requestId"),
  }
}

export async function previewDsarExport(prisma: PrismaClient, raw: DsarInventoryInput): Promise<DsarPreview> {
  const input = normalized(raw)
  const records = await prisma.$transaction((tx) => collectRecords(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return previewFor(input, records)
}

export function encryptDsarBundle(bundle: unknown, encryptionKey: Buffer) {
  if (encryptionKey.length !== 32) throw new Error("[dsar] encryption key должен быть ровно 32 bytes")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(stableJson(bundle), "utf8"), cipher.final()])
  const envelope = {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
  const serialized = `${JSON.stringify(envelope)}\n`
  return { serialized, artifactDigest: sha256(serialized) }
}

export async function executeDsarExport(prisma: PrismaClient, raw: ExecuteDsarExportInput): Promise<DsarExportResult> {
  const input = normalized(raw)
  const outputPath = required(raw.outputPath, "outputPath")
  const approvals = [...new Set(raw.approvals.map((value) => value.trim()).filter(Boolean))]
  if (approvals.length < 2) throw new Error("[dsar] нужны два разных approval ID")
  const legalBasisReceipt = required(raw.legalBasisReceipt, "legalBasisReceipt")
  const expected = `EXPORT ${input.slug} ${input.organizationId} ${input.subjectUserId} ${input.requestId} ${raw.manifestDigest}`
  if (raw.confirmation !== expected) throw new Error("[dsar] confirmation не совпадает с ожидаемым exact value")

  const { records, preview } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 2))`)
    const records = await collectRecords(tx, input)
    return { records, preview: previewFor(input, records) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (required(raw.manifestDigest, "manifestDigest") !== preview.manifestDigest) {
    throw new Error("[dsar] manifest изменился после preview; повторите inventory")
  }
  const exportedAt = new Date().toISOString()
  const encrypted = encryptDsarBundle({ version: 1, exportedAt, request: input, records }, raw.encryptionKey)
  await writeFile(outputPath, encrypted.serialized, { encoding: "utf8", mode: 0o600, flag: "wx" })
  try {
    const audit = await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.subjectUserId,
        action: "dsar.export",
        entityType: "User",
        entityId: input.subjectUserId,
        payload: {
          requestId: input.requestId,
          manifestDigest: preview.manifestDigest,
          artifactDigest: encrypted.artifactDigest,
          recordCount: preview.recordCount,
          categories: preview.categories,
          approvals,
          legalBasisReceipt,
          encryption: "AES-256-GCM",
          exportedAt,
        },
      },
      select: { id: true },
    })
    return { ...preview, auditEventId: audit.id, artifactDigest: encrypted.artifactDigest, encryption: "AES-256-GCM" }
  } catch (error) {
    await unlink(outputPath).catch(() => undefined)
    throw error
  }
}
