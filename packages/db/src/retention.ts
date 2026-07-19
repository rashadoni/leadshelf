import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"

const DAY_MS = 86_400_000
const GPS_KEYS = new Set(["gps", "gpslatitude", "gpslongitude", "latitude", "longitude", "lat", "lng", "lon", "coordinates", "distancem"])

export interface RetentionPolicyInput {
  asOf: string
  mediaDays: number
  gpsDays: number
  auditDays: number
}
export interface RetentionPreview {
  organization: { id: string; slug: string; name: string }
  policy: RetentionPolicyInput
  cutoffs: { media: string; gps: string; audit: string }
  affected: {
    mediaRows: number
    gpsLocationRows: number
    gpsVisitRows: number
    gpsPhotoMetadataRows: number
    gpsEventPayloadRows: number
    gpsAlertPayloadRows: number
    auditRows: number
    goldenReferenceBlockedRows: number
  }
  mediaReferences: string[]
  mediaManifestDigest: string
}
export interface ExecuteRetentionInput {
  organizationId: string
  slug: string
  policy: RetentionPolicyInput
  changeId: string
  reasonCode: string
  confirmation: string
  approvals: string[]
  backupReceipt: string
  mediaDeletionReceipt: string
  legalHoldClearanceReceipt: string
  legalHoldCleared: boolean
  mediaManifestDigest: string
}
export interface RetentionResult {
  auditEventId: string
  organizationId: string
  slug: string
  policy: RetentionPolicyInput
  changeId: string
  reasonCode: string
  deleted: { mediaRows: number; gpsLocationRows: number; auditRows: number }
  redacted: { gpsVisitRows: number; gpsPhotoMetadataRows: number; gpsEventPayloadRows: number; gpsAlertPayloadRows: number }
  backupReceipt: string
  mediaDeletionReceipt: string
  legalHoldClearanceReceipt: string
  mediaManifestDigest: string
}

type Db = PrismaClient | Prisma.TransactionClient
type JsonRow = { id: string; value: Prisma.JsonValue }

function required(value: string, field: string): string {
  const result = value.trim()
  if (!result) throw new Error(`[retention] ${field} обязателен`)
  return result
}
function normalizePolicy(input: RetentionPolicyInput) {
  const asOf = new Date(required(input.asOf, "policy.asOf"))
  if (Number.isNaN(asOf.getTime()) || asOf.toISOString() !== input.asOf) {
    throw new Error("[retention] policy.asOf должен быть точным UTC ISO timestamp")
  }
  for (const [field, value] of Object.entries({ mediaDays: input.mediaDays, gpsDays: input.gpsDays, auditDays: input.auditDays })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 36_500) {
      throw new Error(`[retention] ${field} должен быть целым числом 1..36500`)
    }
  }
  return { policy: { ...input, asOf: asOf.toISOString() }, asOf }
}
function before(asOf: Date, days: number) {
  return new Date(asOf.getTime() - days * DAY_MS)
}
function digest(entries: Array<{ id: string }>, references: string[]) {
  return createHash("sha256")
    .update(entries.map(({ id }) => id).join("\n"))
    .update("\0")
    .update(references.join("\n"))
    .digest("hex")
}
function derivedFrameReferences(exif: Prisma.JsonValue | null, organizationId: string, photoId: string): string[] {
  const prefix = `frames/${organizationId}/${photoId}/`
  const references: string[] = []
  function visit(value: unknown) {
    if (typeof value === "string" && value.startsWith(prefix)) references.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === "object") Object.values(value).forEach(visit)
  }
  visit(exif)
  return references
}
function containsGps(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGps)
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(([key, child]) => GPS_KEYS.has(key.toLowerCase()) || containsGps(child))
}
export function redactLocationData(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(redactLocationData)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !GPS_KEYS.has(key.toLowerCase()))
    .map(([key, child]) => [key, redactLocationData(child as Prisma.JsonValue)]))
}
async function organizationOrThrow(db: Db, organizationId: string, slug: string) {
  const organization = await db.organization.findFirst({ where: { id: organizationId, slug }, select: { id: true, slug: true, name: true } })
  if (!organization) throw new Error("[retention] organizationId/slug не совпадают")
  return organization
}
async function jsonRows(
  db: Db,
  table: "photo_submissions" | "visits" | "product_events" | "alerts",
  column: "exif" | "anomalyFlags" | "payload",
  organizationId: string,
  timeColumn: "takenAt" | "checkInAt" | "occurredAt" | "createdAt",
  cutoff: Date,
  extra = Prisma.empty,
): Promise<JsonRow[]> {
  const rows = await db.$queryRaw<JsonRow[]>(Prisma.sql`
    SELECT "id", ${Prisma.raw(`"${column}"`)} AS value
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "organizationId" = ${organizationId}
      AND ${Prisma.raw(`"${timeColumn}"`)} < ${cutoff}
      AND ${Prisma.raw(`"${column}"`)} IS NOT NULL
      ${extra}
    ORDER BY "id"`)
  return rows.filter(({ value }) => containsGps(value))
}
async function gpsJsonRows(db: Db, organizationId: string, cutoff: Date) {
  const [photos, visits, events, alerts] = await Promise.all([
    jsonRows(db, "photo_submissions", "exif", organizationId, "takenAt", cutoff),
    jsonRows(db, "visits", "anomalyFlags", organizationId, "checkInAt", cutoff),
    jsonRows(db, "product_events", "payload", organizationId, "occurredAt", cutoff, Prisma.sql`AND "kind" = 'visit.anomaly'`),
    jsonRows(db, "alerts", "payload", organizationId, "createdAt", cutoff, Prisma.sql`AND "kind" = 'visit.anomaly'`),
  ])
  return { photos, visits, events, alerts }
}
async function buildPreview(db: Db, organizationId: string, slug: string, input: RetentionPolicyInput): Promise<RetentionPreview> {
  const organization = await organizationOrThrow(db, organizationId, slug)
  const { policy, asOf } = normalizePolicy(input)
  const mediaBefore = before(asOf, policy.mediaDays)
  const gpsBefore = before(asOf, policy.gpsDays)
  const auditBefore = before(asOf, policy.auditDays)
  const [media, gpsLocationRows, gpsVisitRows, auditRows, json] = await Promise.all([
    db.photoSubmission.findMany({
      where: { organizationId, takenAt: { lt: mediaBefore } },
      select: { id: true, url: true, thumbnailUrl: true, exif: true, goldenReferences: { select: { id: true }, take: 1 } },
      orderBy: { id: "asc" },
    }),
    db.agentLocation.count({ where: { agent: { organizationId }, recordedAt: { lt: gpsBefore } } }),
    db.visit.count({ where: { organizationId, checkInAt: { lt: gpsBefore }, OR: [{ checkInLat: { not: null } }, { checkInLng: { not: null } }] } }),
    db.auditLog.count({ where: { organizationId, createdAt: { lt: auditBefore } } }),
    gpsJsonRows(db, organizationId, gpsBefore),
  ])
  const goldenReferenceBlockedRows = media.filter(({ goldenReferences }) => goldenReferences.length > 0).length
  const candidateMediaReferences = [...new Set(media.flatMap(({ id, url, thumbnailUrl, exif }) =>
    [url, thumbnailUrl, ...derivedFrameReferences(exif, organizationId, id)])
    .filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b))
  const mediaReferences = goldenReferenceBlockedRows > 0 ? [] : candidateMediaReferences
  return {
    organization, policy,
    cutoffs: { media: mediaBefore.toISOString(), gps: gpsBefore.toISOString(), audit: auditBefore.toISOString() },
    affected: {
      mediaRows: media.length, gpsLocationRows, gpsVisitRows,
      gpsPhotoMetadataRows: json.photos.length, gpsEventPayloadRows: json.events.length,
      gpsAlertPayloadRows: json.alerts.length, auditRows,
      goldenReferenceBlockedRows,
    },
    mediaReferences,
    mediaManifestDigest: digest(media, mediaReferences),
  }
}
export async function previewRetention(prisma: PrismaClient, input: { organizationId: string; slug: string; policy: RetentionPolicyInput }) {
  return buildPreview(prisma, required(input.organizationId, "organizationId"), required(input.slug, "slug"), input.policy)
}
function validateExecution(input: ExecuteRetentionInput, preview: RetentionPreview) {
  const expected = `PURGE ${input.slug} ${input.organizationId} ${preview.policy.asOf} ${preview.mediaManifestDigest}`
  if (input.confirmation !== expected) throw new Error(`[retention] confirmation должна точно совпадать: ${expected}`)
  if (new Set(input.approvals.map((value) => value.trim()).filter(Boolean)).size < 2) throw new Error("[retention] нужны два разных approval ID")
  required(input.backupReceipt, "backupReceipt")
  required(input.mediaDeletionReceipt, "mediaDeletionReceipt")
  required(input.legalHoldClearanceReceipt, "legalHoldClearanceReceipt")
  required(input.changeId, "changeId")
  required(input.reasonCode, "reasonCode")
  if (!input.legalHoldCleared) throw new Error("[retention] legal hold должен быть явно очищен")
  if (preview.affected.goldenReferenceBlockedRows > 0) {
    throw new Error("[retention] expired media используется GoldenReference; сначала примените отдельную approved reference policy")
  }
  if (required(input.mediaManifestDigest, "mediaManifestDigest") !== preview.mediaManifestDigest) {
    throw new Error("[retention] media manifest изменился после preview; повторите inventory и external deletion")
  }
}
async function redactRows(db: Db, organizationId: string, table: "photo_submissions" | "visits" | "product_events" | "alerts", column: "exif" | "anomalyFlags" | "payload", rows: JsonRow[]) {
  for (const row of rows) {
    await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)}
      SET ${Prisma.raw(`"${column}"`)} = ${JSON.stringify(redactLocationData(row.value))}::jsonb
      WHERE "id" = ${row.id} AND "organizationId" = ${organizationId}`)
  }
  return rows.length
}
export async function executeRetention(prisma: PrismaClient, input: ExecuteRetentionInput): Promise<RetentionResult> {
  const organizationId = required(input.organizationId, "organizationId")
  const slug = required(input.slug, "slug")
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 1))`)
    const preview = await buildPreview(tx, organizationId, slug, input.policy)
    validateExecution({ ...input, organizationId, slug }, preview)
    const gpsBefore = new Date(preview.cutoffs.gps)
    const json = await gpsJsonRows(tx, organizationId, gpsBefore)
    const gpsPhotoMetadataRows = await redactRows(tx, organizationId, "photo_submissions", "exif", json.photos)
    const gpsVisitJsonRows = await redactRows(tx, organizationId, "visits", "anomalyFlags", json.visits)
    const gpsEventPayloadRows = await redactRows(tx, organizationId, "product_events", "payload", json.events)
    const gpsAlertPayloadRows = await redactRows(tx, organizationId, "alerts", "payload", json.alerts)
    const gpsVisitRows = await tx.visit.updateMany({
      where: { organizationId, checkInAt: { lt: gpsBefore }, OR: [{ checkInLat: { not: null } }, { checkInLng: { not: null } }] },
      data: { checkInLat: null, checkInLng: null },
    })
    const gpsLocationRows = await tx.agentLocation.deleteMany({ where: { agent: { organizationId }, recordedAt: { lt: gpsBefore } } })
    const mediaRows = await tx.photoSubmission.deleteMany({ where: { organizationId, takenAt: { lt: new Date(preview.cutoffs.media) } } })
    const auditRows = await tx.auditLog.deleteMany({ where: { organizationId, createdAt: { lt: new Date(preview.cutoffs.audit) } } })
    const result = {
      organizationId, slug, policy: preview.policy,
      changeId: input.changeId.trim(), reasonCode: input.reasonCode.trim(),
      deleted: { mediaRows: mediaRows.count, gpsLocationRows: gpsLocationRows.count, auditRows: auditRows.count },
      redacted: { gpsVisitRows: gpsVisitRows.count, gpsPhotoMetadataRows, gpsEventPayloadRows, gpsAlertPayloadRows },
      backupReceipt: input.backupReceipt.trim(), mediaDeletionReceipt: input.mediaDeletionReceipt.trim(),
      legalHoldClearanceReceipt: input.legalHoldClearanceReceipt.trim(),
      mediaManifestDigest: preview.mediaManifestDigest,
    }
    const audit = await tx.auditLog.create({
      data: {
        organizationId,
        action: "retention.execute",
        entityType: "organization",
        entityId: organizationId,
        payload: {
          policy: preview.policy,
          changeId: result.changeId,
          reasonCode: result.reasonCode,
          cutoffs: preview.cutoffs,
          deleted: result.deleted,
          redacted: result.redacted,
          mediaManifestDigest: result.mediaManifestDigest,
          approvalIds: [...new Set(input.approvals.map((value) => value.trim()).filter(Boolean))],
          backupReceipt: result.backupReceipt,
          mediaDeletionReceipt: result.mediaDeletionReceipt,
          legalHoldClearanceReceipt: result.legalHoldClearanceReceipt,
        } as unknown as Prisma.InputJsonObject,
      },
    })
    return { auditEventId: audit.id, ...result }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
