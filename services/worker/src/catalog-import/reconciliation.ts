import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import {
  parsePriceRow,
  parseSalesRow,
  parseStockRow,
  type RawCsvRow,
} from "@leadshelf/core"

export type ImportReconciliation = {
  status: "MATCH" | "MISMATCH"
  sourceRows: number
  importedRows: number
  errorRows: number
  sourceChecksum: string
  sourceTotals?: Record<string, string>
  expectedTotals?: Record<string, string>
  mismatches: string[]
}

type SnapshotEntity = "prices" | "stock" | "sales"

function parseExactDecimal(value: string): { coefficient: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error(`invalid canonical decimal: ${value}`)
  const fraction = match[3] ?? ""
  const coefficient = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`)
  return { coefficient, scale: fraction.length }
}

function formatExactDecimal(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return "0"
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0")
  if (scale === 0) return `${negative ? "-" : ""}${digits}`
  const integer = digits.slice(0, -scale)
  const fraction = digits.slice(-scale).replace(/0+$/, "")
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`
}

export function sumExactDecimals(values: Array<string | null | undefined>): string {
  const parsed = values.filter((value): value is string => value != null).map(parseExactDecimal)
  if (parsed.length === 0) return "0"
  const scale = Math.max(...parsed.map((value) => value.scale))
  const total = parsed.reduce(
    (sum, value) => sum + value.coefficient * 10n ** BigInt(scale - value.scale),
    0n,
  )
  return formatExactDecimal(total, scale)
}

export function buildSnapshotSourceTotals(
  entityType: SnapshotEntity,
  rows: RawCsvRow[],
): Record<string, string> {
  if (entityType === "prices") {
    const parsed = rows.map((row, index) => parsePriceRow(row, index + 2)).filter((result) => result.ok)
    return {
      price: sumExactDecimals(parsed.map((result) => result.value.price)),
      costPrice: sumExactDecimals(parsed.map((result) => result.value.costPrice)),
    }
  }
  if (entityType === "stock") {
    const parsed = rows.map((row, index) => parseStockRow(row, index + 2)).filter((result) => result.ok)
    return { quantity: sumExactDecimals(parsed.map((result) => result.value.quantity)) }
  }
  const parsed = rows.map((row, index) => parseSalesRow(row, index + 2)).filter((result) => result.ok)
  return {
    quantity: sumExactDecimals(parsed.map((result) => result.value.quantity)),
    revenue: sumExactDecimals(parsed.map((result) => result.value.revenue)),
    profit: sumExactDecimals(parsed.map((result) => result.value.profit)),
  }
}

function canonicalRow(row: RawCsvRow): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key] ?? ""]),
  )
}

export function checksumImportRows(rows: RawCsvRow[]): string {
  const canonicalRows = rows.map(canonicalRow).sort()
  return createHash("sha256").update(JSON.stringify(canonicalRows)).digest("hex")
}

export function buildImportReconciliation(input: {
  rows: RawCsvRow[]
  importedRows: number
  errorRows: number
  expectedRows?: number
  expectedChecksum?: string
  sourceTotals?: Record<string, string>
  expectedTotals?: Record<string, string>
  processedRows: number
}): ImportReconciliation {
  const sourceChecksum = checksumImportRows(input.rows)
  const mismatches: string[] = []
  if (input.processedRows !== input.rows.length) {
    mismatches.push("processed_row_count_mismatch")
  }
  if (input.expectedRows != null && input.expectedRows !== input.rows.length) {
    mismatches.push("erp_row_count_mismatch")
  }
  if (input.expectedChecksum && input.expectedChecksum.toLowerCase() !== sourceChecksum) {
    mismatches.push("erp_checksum_mismatch")
  }
  if (input.expectedTotals) {
    for (const [field, expected] of Object.entries(input.expectedTotals).sort(([a], [b]) => a.localeCompare(b))) {
      const actual = input.sourceTotals?.[field]
      if (actual == null || sumExactDecimals([expected]) !== sumExactDecimals([actual])) {
        mismatches.push(`erp_total_${field}_mismatch`)
      }
    }
  }
  return {
    status: mismatches.length === 0 ? "MATCH" : "MISMATCH",
    sourceRows: input.rows.length,
    importedRows: input.importedRows,
    errorRows: input.errorRows,
    sourceChecksum,
    ...(input.sourceTotals ? { sourceTotals: input.sourceTotals } : {}),
    ...(input.expectedTotals ? { expectedTotals: input.expectedTotals } : {}),
    mismatches,
  }
}

const FULL_SYNC_APPROVAL_MAX_TTL_MS = 60 * 60_000

export type DestructiveFullSyncApprovalPayload = {
  version: 1
  action: "deactivate_absent_products"
  approvalId: string
  organizationId: string
  entityType: "products"
  sourceChecksum: string
  currentActiveRows: number
  incomingActiveRows: number
  issuedAt: string
  expiresAt: string
}

type DestructiveFullSyncGuardReason =
  | "input_invalid"
  | "mass_zero"
  | "mass_drop"
  | "approval_invalid"
  | "approval_expired"
  | "approval_mismatch"

function validApprovalSecret(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= 32
}

function validApprovalPayload(payload: unknown): payload is DestructiveFullSyncApprovalPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const value = payload as Record<string, unknown>
  const exactKeys = [
    "action",
    "approvalId",
    "currentActiveRows",
    "entityType",
    "expiresAt",
    "incomingActiveRows",
    "issuedAt",
    "organizationId",
    "sourceChecksum",
    "version",
  ]
  if (Object.keys(value).sort().join("\0") !== exactKeys.join("\0")) return false
  if (value.version !== 1 || value.action !== "deactivate_absent_products" || value.entityType !== "products") return false
  if (typeof value.approvalId !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(value.approvalId)) return false
  if (typeof value.organizationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.organizationId)) return false
  if (typeof value.sourceChecksum !== "string" || !/^[0-9a-f]{64}$/.test(value.sourceChecksum)) return false
  if (!Number.isSafeInteger(value.currentActiveRows) || Number(value.currentActiveRows) < 0) return false
  if (!Number.isSafeInteger(value.incomingActiveRows) || Number(value.incomingActiveRows) < 0) return false
  if (typeof value.issuedAt !== "string" || typeof value.expiresAt !== "string") return false
  const issuedAt = new Date(value.issuedAt)
  const expiresAt = new Date(value.expiresAt)
  if (!Number.isFinite(issuedAt.getTime()) || issuedAt.toISOString() !== value.issuedAt) return false
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== value.expiresAt) return false
  const ttl = expiresAt.getTime() - issuedAt.getTime()
  return ttl > 0 && ttl <= FULL_SYNC_APPROVAL_MAX_TTL_MS
}

function canonicalApprovalPayload(payload: DestructiveFullSyncApprovalPayload): string {
  return JSON.stringify({
    version: payload.version,
    action: payload.action,
    approvalId: payload.approvalId,
    organizationId: payload.organizationId,
    entityType: payload.entityType,
    sourceChecksum: payload.sourceChecksum,
    currentActiveRows: payload.currentActiveRows,
    incomingActiveRows: payload.incomingActiveRows,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  })
}

export function signDestructiveFullSyncApproval(
  payload: DestructiveFullSyncApprovalPayload,
  secret: string,
): string {
  if (!validApprovalSecret(secret)) throw new Error("full_sync_approval_secret_invalid")
  if (!validApprovalPayload(payload)) throw new Error("full_sync_approval_payload_invalid")
  const encoded = Buffer.from(canonicalApprovalPayload(payload), "utf8").toString("base64url")
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url")
  return `${encoded}.${signature}`
}

function verifyDestructiveFullSyncApproval(
  token: string,
  secret: string,
): DestructiveFullSyncApprovalPayload | null {
  if (!validApprovalSecret(secret) || token.length < 80 || token.length > 2_048) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [encoded, suppliedSignature] = parts
  if (!encoded || !suppliedSignature || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(suppliedSignature)) return null
  const expected = createHmac("sha256", secret).update(encoded).digest()
  const supplied = Buffer.from(suppliedSignature, "base64url")
  if (
    supplied.toString("base64url") !== suppliedSignature ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) return null
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8")
    if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) return null
    const payload: unknown = JSON.parse(decoded)
    return validApprovalPayload(payload) ? payload : null
  } catch {
    return null
  }
}

export function guardDestructiveFullSync(input: {
  organizationId: string
  entityType: "products"
  sourceChecksum: string
  currentActiveRows: number
  incomingActiveRows: number
  approvalToken?: string
  approvalSecret?: string
  now?: Date
  maxDropRatio?: number
}): { allowed: true; approvalId?: string } | { allowed: false; reason: DestructiveFullSyncGuardReason; dropRatio: number } {
  const current = input.currentActiveRows
  const incoming = input.incomingActiveRows
  const maxDropRatio = input.maxDropRatio ?? 0.1
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.organizationId) ||
    input.entityType !== "products" ||
    !/^[0-9a-f]{64}$/.test(input.sourceChecksum) ||
    !Number.isSafeInteger(current) || current < 0 ||
    !Number.isSafeInteger(incoming) || incoming < 0 ||
    !Number.isFinite(maxDropRatio) || maxDropRatio < 0 || maxDropRatio > 1
  ) {
    return { allowed: false, reason: "input_invalid", dropRatio: 0 }
  }
  const dropRatio = current === 0 ? 0 : Math.max(0, (current - incoming) / current)
  const destructiveReason = current > 0 && incoming === 0
    ? "mass_zero"
    : dropRatio > maxDropRatio
      ? "mass_drop"
      : null
  if (!destructiveReason) return { allowed: true }
  if (!input.approvalToken || !input.approvalSecret) {
    return { allowed: false, reason: destructiveReason, dropRatio }
  }
  const approval = verifyDestructiveFullSyncApproval(input.approvalToken, input.approvalSecret)
  if (!approval) return { allowed: false, reason: "approval_invalid", dropRatio }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) return { allowed: false, reason: "input_invalid", dropRatio }
  const issuedAt = new Date(approval.issuedAt).getTime()
  const expiresAt = new Date(approval.expiresAt).getTime()
  if (issuedAt > now.getTime() + 60_000 || expiresAt <= now.getTime()) {
    return { allowed: false, reason: "approval_expired", dropRatio }
  }
  if (
    approval.organizationId !== input.organizationId ||
    approval.entityType !== input.entityType ||
    approval.sourceChecksum !== input.sourceChecksum ||
    approval.currentActiveRows !== current ||
    approval.incomingActiveRows !== incoming
  ) {
    return { allowed: false, reason: "approval_mismatch", dropRatio }
  }
  return { allowed: true, approvalId: approval.approvalId }
}
