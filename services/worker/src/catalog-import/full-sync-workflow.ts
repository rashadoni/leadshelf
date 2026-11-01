import type { PrismaClient } from "@leadshelf/prisma-client"
import { parseProductRow, type RawCsvRow } from "@leadshelf/core"
import { createHash } from "node:crypto"

import { readCsvRecords } from "./csv"
import { readProtectedFullSyncFile, writeProtectedFullSyncFile } from "./full-sync-approval"
import {
  checksumImportRows,
  verifyDestructiveFullSyncApproval,
  type DestructiveFullSyncApprovalPayload,
} from "./reconciliation"
import { readXlsxRecords } from "./xlsx"

export type FullSyncWorkflowErrorCode =
  | "control_invalid"
  | "job_not_waiting"
  | "source_invalid"
  | "manifest_mismatch"
  | "approval_invalid"
  | "approval_expired"
  | "approval_mismatch"
  | "approval_already_attached"

export class FullSyncWorkflowError extends Error {
  constructor(readonly code: FullSyncWorkflowErrorCode) {
    super(code)
    this.name = "FullSyncWorkflowError"
  }
}

function fail(code: FullSyncWorkflowErrorCode): never {
  throw new FullSyncWorkflowError(code)
}

type FullSyncJob = {
  id: string
  organizationId: string
  entityType: string
  source: string
  storagePath: string
  encoding: string | null
  delimiter: string | null
  expectedRows: number | null
  expectedChecksum: string | null
  syncMode: string
  fullSyncApprovalPath: string | null
  status: string
}

export async function readCatalogImportJobRows(job: FullSyncJob, expectedUid?: number): Promise<RawCsvRow[]> {
  const uid = expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("source_invalid")
  const buffer = await readProtectedFullSyncFile(job.storagePath, Number(uid), 1024 * 1024 * 1024)
  return job.source === "xlsx"
    ? readXlsxRecords(buffer)
    : readCsvRecords(buffer, {
        encoding: job.encoding === "windows-1251" ? "windows-1251" : "utf-8",
        delimiter: job.delimiter === ";" ? ";" : job.delimiter === "," ? "," : undefined,
      })
}

export function analyzeFullSyncProductRows(rows: RawCsvRow[]): {
  sourceChecksum: string
  incomingActiveRows: number
  activeSkus: string[]
} {
  const seen = new Set<string>()
  const activeSkus: string[] = []
  for (let index = 0; index < rows.length; index++) {
    const parsed = parseProductRow(rows[index]!, index + 2)
    if (!parsed.ok || seen.has(parsed.value.sku)) fail("source_invalid")
    seen.add(parsed.value.sku)
    if (parsed.value.isActive) activeSkus.push(parsed.value.sku)
  }
  return {
    sourceChecksum: checksumImportRows(rows),
    incomingActiveRows: activeSkus.length,
    activeSkus,
  }
}

export function checksumActiveProductSkus(skus: string[]): string {
  return createHash("sha256").update(JSON.stringify([...skus].sort())).digest("hex")
}

async function currentActiveCatalog(prisma: PrismaClient, organizationId: string): Promise<{
  rows: number
  checksum: string
}> {
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    select: { sku: true },
    orderBy: { sku: "asc" },
  })
  return { rows: products.length, checksum: checksumActiveProductSkus(products.map((product) => product.sku)) }
}

export function validateExactFullSyncApproval(
  token: string,
  secret: string,
  context: {
    organizationId: string
    sourceChecksum: string
    currentActiveChecksum: string
    currentActiveRows: number
    incomingActiveRows: number
  },
  now: Date,
): DestructiveFullSyncApprovalPayload {
  const approval = verifyDestructiveFullSyncApproval(token, secret)
  if (!approval) fail("approval_invalid")
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs) || new Date(approval.issuedAt).getTime() > nowMs + 60_000 || new Date(approval.expiresAt).getTime() <= nowMs) {
    fail("approval_expired")
  }
  if (
    approval.organizationId !== context.organizationId ||
    approval.entityType !== "products" ||
    approval.sourceChecksum !== context.sourceChecksum ||
    approval.currentActiveChecksum !== context.currentActiveChecksum ||
    approval.currentActiveRows !== context.currentActiveRows ||
    approval.incomingActiveRows !== context.incomingActiveRows
  ) fail("approval_mismatch")
  return approval
}

function parseSecret(buffer: Buffer): string {
  const secret = buffer.toString("utf8").replace(/\r?\n$/, "")
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret)) fail("approval_invalid")
  return secret
}

function parseToken(buffer: Buffer): string {
  const token = buffer.toString("utf8").replace(/\r?\n$/, "")
  if (!/^[A-Za-z0-9_-]{40,1800}\.[A-Za-z0-9_-]{40,100}$/.test(token)) fail("approval_invalid")
  return token
}

export async function attachFullSyncApprovalToJob(
  prisma: PrismaClient,
  input: {
    organizationId: string
    jobId: string
    tokenFile: string
    secretFile: string
    expectedUid?: number
    now?: Date
  },
): Promise<{ changeId: string }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.organizationId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.jobId)) {
    fail("control_invalid")
  }
  const expectedUid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(expectedUid) || Number(expectedUid) < 0) fail("control_invalid")
  const job = await prisma.importQueueJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
      entityType: "products",
      syncMode: "full",
      status: "PENDING",
    },
  })
  if (!job) fail("job_not_waiting")
  if (job.fullSyncApprovalPath) fail("approval_already_attached")
  if (job.expectedRows == null || job.expectedChecksum == null) fail("manifest_mismatch")

  let rows: RawCsvRow[]
  try {
    rows = await readCatalogImportJobRows(job, Number(expectedUid))
  } catch {
    fail("source_invalid")
  }
  const analysis = analyzeFullSyncProductRows(rows)
  if (job.expectedRows !== rows.length || job.expectedChecksum !== analysis.sourceChecksum) fail("manifest_mismatch")
  const [currentActive, tokenBuffer, secretBuffer] = await Promise.all([
    currentActiveCatalog(prisma, job.organizationId),
    readProtectedFullSyncFile(input.tokenFile, Number(expectedUid), 4 * 1024),
    readProtectedFullSyncFile(input.secretFile, Number(expectedUid), 4 * 1024),
  ])
  const approval = validateExactFullSyncApproval(
    parseToken(tokenBuffer),
    parseSecret(secretBuffer),
    {
      organizationId: job.organizationId,
      sourceChecksum: analysis.sourceChecksum,
      currentActiveRows: currentActive.rows,
      currentActiveChecksum: currentActive.checksum,
      incomingActiveRows: analysis.incomingActiveRows,
    },
    input.now ?? new Date(),
  )
  const attached = await prisma.importQueueJob.updateMany({
    where: {
      id: job.id,
      organizationId: job.organizationId,
      status: "PENDING",
      syncMode: "full",
      fullSyncApprovalPath: null,
    },
    data: { fullSyncApprovalPath: input.tokenFile, fullSyncApprovedAt: input.now ?? new Date() },
  })
  if (attached.count !== 1) fail("approval_already_attached")
  return { changeId: approval.changeId }
}

export async function validateAttachedFullSyncApproval(
  prisma: PrismaClient,
  input: {
    job: FullSyncJob
    rows: RawCsvRow[]
    secretFile: string
    expectedUid?: number
    now?: Date
  },
): Promise<{
  approval: DestructiveFullSyncApprovalPayload
  sourceChecksum: string
  currentActiveRows: number
  currentActiveChecksum: string
  incomingActiveRows: number
  activeSkus: string[]
}> {
  const expectedUid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(expectedUid) || Number(expectedUid) < 0) fail("control_invalid")
  if (!input.job.fullSyncApprovalPath || input.job.syncMode !== "full" || input.job.entityType !== "products") {
    fail("job_not_waiting")
  }
  const analysis = analyzeFullSyncProductRows(input.rows)
  if (
    input.job.expectedRows !== input.rows.length ||
    input.job.expectedChecksum !== analysis.sourceChecksum
  ) fail("manifest_mismatch")
  const [currentActive, tokenBuffer, secretBuffer] = await Promise.all([
    currentActiveCatalog(prisma, input.job.organizationId),
    readProtectedFullSyncFile(input.job.fullSyncApprovalPath, Number(expectedUid), 4 * 1024),
    readProtectedFullSyncFile(input.secretFile, Number(expectedUid), 4 * 1024),
  ])
  const approval = validateExactFullSyncApproval(
    parseToken(tokenBuffer),
    parseSecret(secretBuffer),
    {
      organizationId: input.job.organizationId,
      sourceChecksum: analysis.sourceChecksum,
      currentActiveRows: currentActive.rows,
      currentActiveChecksum: currentActive.checksum,
      incomingActiveRows: analysis.incomingActiveRows,
    },
    input.now ?? new Date(),
  )
  return {
    approval,
    currentActiveRows: currentActive.rows,
    currentActiveChecksum: currentActive.checksum,
    ...analysis,
  }
}

export async function readFullSyncAttachControlFile(filePath: string, expectedUid?: number): Promise<{
  organizationId: string
  jobId: string
}> {
  const uid = expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("control_invalid")
  let raw: unknown
  try {
    raw = JSON.parse((await readProtectedFullSyncFile(filePath, Number(uid), 16 * 1024)).toString("utf8"))
  } catch {
    fail("control_invalid")
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("control_invalid")
  const value = raw as Record<string, unknown>
  const actualKeys = Object.keys(value).sort().join("\0")
  const prepareKeys = [
    "changeId", "jobId", "organizationId", "reasonCode",
    "requesterApprovalId", "reviewerApprovalId", "ttlSeconds",
  ].join("\0")
  if (actualKeys !== "jobId\0organizationId" && actualKeys !== prepareKeys) fail("control_invalid")
  if (typeof value.organizationId !== "string" || typeof value.jobId !== "string") fail("control_invalid")
  return { organizationId: value.organizationId, jobId: value.jobId }
}

export async function prepareFullSyncApprovalRequest(
  prisma: PrismaClient,
  input: {
    controlFile: string
    outputFile: string
    expectedUid?: number
    now?: Date
  },
): Promise<{ changeId: string }> {
  const uid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("control_invalid")
  let raw: unknown
  try {
    raw = JSON.parse((await readProtectedFullSyncFile(input.controlFile, Number(uid), 16 * 1024)).toString("utf8"))
  } catch {
    fail("control_invalid")
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("control_invalid")
  const value = raw as Record<string, unknown>
  const keys = [
    "changeId",
    "jobId",
    "organizationId",
    "reasonCode",
    "requesterApprovalId",
    "reviewerApprovalId",
    "ttlSeconds",
  ]
  if (Object.keys(value).sort().join("\0") !== keys.join("\0")) fail("control_invalid")
  for (const key of ["changeId", "jobId", "organizationId", "reasonCode", "requesterApprovalId", "reviewerApprovalId"] as const) {
    if (typeof value[key] !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value[key])) fail("control_invalid")
  }
  if (value.requesterApprovalId === value.reviewerApprovalId) fail("control_invalid")
  if (!Number.isSafeInteger(value.ttlSeconds) || Number(value.ttlSeconds) < 60 || Number(value.ttlSeconds) > 3600) {
    fail("control_invalid")
  }
  const job = await prisma.importQueueJob.findFirst({
    where: {
      id: value.jobId as string,
      organizationId: value.organizationId as string,
      entityType: "products",
      syncMode: "full",
      status: "PENDING",
      fullSyncApprovalPath: null,
    },
  })
  if (!job) fail("job_not_waiting")
  if (job.expectedRows == null || job.expectedChecksum == null) fail("manifest_mismatch")
  let rows: RawCsvRow[]
  try {
    rows = await readCatalogImportJobRows(job, Number(uid))
  } catch {
    fail("source_invalid")
  }
  const analysis = analyzeFullSyncProductRows(rows)
  if (job.expectedRows !== rows.length || job.expectedChecksum !== analysis.sourceChecksum) fail("manifest_mismatch")
  const currentActive = await currentActiveCatalog(prisma, job.organizationId)
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) fail("control_invalid")
  const payload: DestructiveFullSyncApprovalPayload = {
    version: 1,
    action: "deactivate_absent_products",
    changeId: value.changeId as string,
    requesterApprovalId: value.requesterApprovalId as string,
    reviewerApprovalId: value.reviewerApprovalId as string,
    reasonCode: value.reasonCode as string,
    organizationId: job.organizationId,
    entityType: "products",
    sourceChecksum: analysis.sourceChecksum,
    currentActiveRows: currentActive.rows,
    currentActiveChecksum: currentActive.checksum,
    incomingActiveRows: analysis.incomingActiveRows,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Number(value.ttlSeconds) * 1_000).toISOString(),
  }
  await writeProtectedFullSyncFile(input.outputFile, `${JSON.stringify(payload)}\n`, Number(uid))
  return { changeId: payload.changeId }
}
