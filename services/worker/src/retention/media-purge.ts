import type { PrismaClient } from "@leadshelf/prisma-client"
import { createHash } from "node:crypto"

import {
  executeRetention,
  previewRetention,
  type RetentionPolicyInput,
  type RetentionResult,
} from "@leadshelf/db"

import { readProtectedFullSyncFile, writeProtectedFullSyncFile } from "../catalog-import/full-sync-approval"

export type RetentionMediaPurgeErrorCode =
  | "control_invalid"
  | "manifest_invalid"
  | "manifest_too_large"
  | "manifest_drift"
  | "golden_reference_blocked"
  | "object_key_invalid"
  | "object_missing"
  | "object_drift"
  | "object_store_failed"
  | "database_preview_failed"
  | "manifest_write_failed"
  | "database_purge_failed"

export class RetentionMediaPurgeError extends Error {
  constructor(readonly code: RetentionMediaPurgeErrorCode) {
    super(code)
    this.name = "RetentionMediaPurgeError"
  }
}

function fail(code: RetentionMediaPurgeErrorCode): never {
  throw new RetentionMediaPurgeError(code)
}

export type RetentionMediaPurgeControl = {
  version: 1
  organizationId: string
  slug: string
  changeId: string
  requesterApprovalId: string
  reviewerApprovalId: string
  reasonCode: string
  backupReceipt: string
  legalHoldClearanceReceipt: string
  issuedAt: string
  expiresAt: string
  policy: RetentionPolicyInput
  mediaManifestDigest: string
  confirmation: string
}

export type RetentionObjectVersion = {
  versionId: string | null
  deleteMarker: boolean
}

export type PreparedRetentionObject = {
  key: string
  versions: RetentionObjectVersion[]
}

export type RetentionMediaPurgeManifest = {
  version: 1
  preparedAt: string
  control: RetentionMediaPurgeControl
  objects: PreparedRetentionObject[]
}

export interface RetentionObjectStore {
  listExactVersions(key: string): Promise<RetentionObjectVersion[]>
  headExists(key: string): Promise<boolean>
  deleteExactVersion(key: string, versionId: string | null): Promise<void>
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/
const RECEIPT = /^[A-Za-z0-9._:/-]{1,256}$/
const SHA256 = /^[a-f0-9]{64}$/

function exactKeys(value: Record<string, unknown>, keys: string[], code: RetentionMediaPurgeErrorCode): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(code)
}

function validPolicy(value: unknown): value is RetentionPolicyInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  exactKeys(policy, ["asOf", "auditDays", "gpsDays", "mediaDays"], "control_invalid")
  if (typeof policy.asOf !== "string") return false
  try {
    if (new Date(policy.asOf).toISOString() !== policy.asOf) return false
  } catch {
    return false
  }
  return [policy.mediaDays, policy.gpsDays, policy.auditDays]
    .every((days) => Number.isSafeInteger(days) && Number(days) >= 1 && Number(days) <= 36_500)
}

export function validateRetentionMediaPurgeControl(
  value: unknown,
  now = new Date(),
  options: { allowExpired?: boolean } = {},
): RetentionMediaPurgeControl {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("control_invalid")
  const control = value as Record<string, unknown>
  exactKeys(control, [
    "backupReceipt", "changeId", "confirmation", "expiresAt", "issuedAt", "legalHoldClearanceReceipt", "mediaManifestDigest",
    "organizationId", "policy", "reasonCode", "requesterApprovalId", "reviewerApprovalId", "slug", "version",
  ], "control_invalid")
  if (control.version !== 1) fail("control_invalid")
  for (const key of ["organizationId", "slug", "changeId", "reasonCode", "requesterApprovalId", "reviewerApprovalId"] as const) {
    if (typeof control[key] !== "string" || !IDENTIFIER.test(control[key])) fail("control_invalid")
  }
  if (control.requesterApprovalId === control.reviewerApprovalId) fail("control_invalid")
  if (typeof control.backupReceipt !== "string" || !RECEIPT.test(control.backupReceipt)) fail("control_invalid")
  if (typeof control.legalHoldClearanceReceipt !== "string" || !RECEIPT.test(control.legalHoldClearanceReceipt)) fail("control_invalid")
  if (typeof control.mediaManifestDigest !== "string" || !SHA256.test(control.mediaManifestDigest)) fail("control_invalid")
  if (!validPolicy(control.policy)) fail("control_invalid")
  if (typeof control.issuedAt !== "string" || typeof control.expiresAt !== "string") fail("control_invalid")
  let issuedAt: number
  let expiresAt: number
  try {
    issuedAt = new Date(control.issuedAt).getTime()
    expiresAt = new Date(control.expiresAt).getTime()
    if (new Date(issuedAt).toISOString() !== control.issuedAt || new Date(expiresAt).toISOString() !== control.expiresAt) fail("control_invalid")
  } catch {
    fail("control_invalid")
  }
  const nowMs = now.getTime()
  if (
    !Number.isFinite(nowMs) || issuedAt > nowMs + 60_000 || (!options.allowExpired && expiresAt <= nowMs) ||
    expiresAt - issuedAt < 5 * 60_000 || expiresAt - issuedAt > 24 * 60 * 60_000
  ) fail("control_invalid")
  const policy = control.policy as RetentionPolicyInput
  const expected = `PURGE RETENTION ${control.slug} ${control.organizationId} ${policy.asOf} ${control.mediaManifestDigest}`
  if (control.confirmation !== expected) fail("control_invalid")
  return control as RetentionMediaPurgeControl
}

function safeMediaKey(key: string, organizationId: string): boolean {
  if (!key || key.length > 1_024 || key.includes("\\") || key.includes("\0") || key.split("/").includes("..")) return false
  return key.startsWith(`photos/${organizationId}/`) || key.startsWith(`frames/${organizationId}/`)
}

function normalizeVersions(value: RetentionObjectVersion[]): RetentionObjectVersion[] {
  const seen = new Set<string>()
  return value.map((entry) => {
    if (
      !entry || typeof entry !== "object" ||
      (entry.versionId !== null && (typeof entry.versionId !== "string" || entry.versionId.length < 1 || entry.versionId.length > 1_024)) ||
      typeof entry.deleteMarker !== "boolean"
    ) fail("manifest_invalid")
    const identity = `${entry.versionId ?? "<null>"}\0${entry.deleteMarker}`
    if (seen.has(identity)) fail("manifest_invalid")
    seen.add(identity)
    return { versionId: entry.versionId, deleteMarker: entry.deleteMarker }
  }).sort((a, b) => `${a.versionId ?? ""}:${a.deleteMarker}`.localeCompare(`${b.versionId ?? ""}:${b.deleteMarker}`))
}

function versionIdentity(value: RetentionObjectVersion): string {
  return `${value.versionId ?? "<null>"}\0${value.deleteMarker}`
}

function validatePreparedManifest(value: unknown, now: Date): RetentionMediaPurgeManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("manifest_invalid")
  const manifest = value as Record<string, unknown>
  exactKeys(manifest, ["control", "objects", "preparedAt", "version"], "manifest_invalid")
  if (manifest.version !== 1 || typeof manifest.preparedAt !== "string") fail("manifest_invalid")
  try {
    if (new Date(manifest.preparedAt).toISOString() !== manifest.preparedAt) fail("manifest_invalid")
  } catch {
    fail("manifest_invalid")
  }
  const control = validateRetentionMediaPurgeControl(manifest.control, now, { allowExpired: true })
  if (!Array.isArray(manifest.objects) || manifest.objects.length > 1_000_000) fail("manifest_invalid")
  const seenKeys = new Set<string>()
  const objects = manifest.objects.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("manifest_invalid")
    const object = raw as Record<string, unknown>
    exactKeys(object, ["key", "versions"], "manifest_invalid")
    if (typeof object.key !== "string" || !safeMediaKey(object.key, control.organizationId) || seenKeys.has(object.key)) {
      fail("object_key_invalid")
    }
    seenKeys.add(object.key)
    if (!Array.isArray(object.versions) || object.versions.length < 1) fail("manifest_invalid")
    return { key: object.key, versions: normalizeVersions(object.versions as RetentionObjectVersion[]) }
  }).sort((a, b) => a.key.localeCompare(b.key))
  return { version: 1, preparedAt: manifest.preparedAt, control, objects }
}

async function protectedJson(filePath: string, expectedUid: number, maxBytes: number): Promise<unknown> {
  try {
    return JSON.parse((await readProtectedFullSyncFile(filePath, expectedUid, maxBytes)).toString("utf8"))
  } catch {
    fail("control_invalid")
  }
}

function exactReferenceSet(references: string[], organizationId: string): string[] {
  const unique = [...new Set(references)]
  if (unique.length !== references.length || unique.some((key) => !safeMediaKey(key, organizationId))) fail("object_key_invalid")
  return unique.sort((a, b) => a.localeCompare(b))
}

async function currentPreview(prisma: PrismaClient, control: RetentionMediaPurgeControl) {
  let preview
  try {
    preview = await previewRetention(prisma, {
      organizationId: control.organizationId,
      slug: control.slug,
      policy: control.policy,
    })
  } catch {
    fail("database_preview_failed")
  }
  if (preview.mediaManifestDigest !== control.mediaManifestDigest) fail("manifest_drift")
  if (preview.affected.goldenReferenceBlockedRows > 0) fail("golden_reference_blocked")
  return { preview, references: exactReferenceSet(preview.mediaReferences, control.organizationId) }
}

export async function prepareRetentionMediaPurge(
  prisma: PrismaClient,
  store: RetentionObjectStore,
  input: { controlFile: string; outputFile: string; expectedUid?: number; now?: Date },
): Promise<{ objects: number }> {
  const uid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("control_invalid")
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) fail("control_invalid")
  const control = validateRetentionMediaPurgeControl(await protectedJson(input.controlFile, Number(uid), 64 * 1024), now)
  const { references } = await currentPreview(prisma, control)
  const objects: PreparedRetentionObject[] = []
  try {
    for (const key of references) {
      const listed = normalizeVersions(await store.listExactVersions(key))
      if (listed.length > 0) objects.push({ key, versions: listed })
      else if (await store.headExists(key)) objects.push({ key, versions: [{ versionId: null, deleteMarker: false }] })
      else fail("object_missing")
    }
  } catch (error) {
    if (error instanceof RetentionMediaPurgeError) throw error
    fail("object_store_failed")
  }
  const serializedManifest = `${JSON.stringify({
      version: 1,
      preparedAt: now.toISOString(),
      control,
      objects,
    } satisfies RetentionMediaPurgeManifest)}\n`
  if (Buffer.byteLength(serializedManifest) > 64 * 1024 * 1024) fail("manifest_too_large")
  try {
    await writeProtectedFullSyncFile(input.outputFile, serializedManifest, Number(uid))
  } catch {
    fail("manifest_write_failed")
  }
  return { objects: objects.length }
}

function receiptFor(manifest: RetentionMediaPurgeManifest): string {
  const value = manifest.objects.map(({ key, versions }) => ({ key, versions })).sort((a, b) => a.key.localeCompare(b.key))
  return `s3-purge:v1:${createHash("sha256").update(JSON.stringify({
    organizationId: manifest.control.organizationId,
    mediaManifestDigest: manifest.control.mediaManifestDigest,
    objects: value,
  })).digest("hex")}`
}

export async function executePreparedRetentionMediaPurge(
  prisma: PrismaClient,
  store: RetentionObjectStore,
  input: { manifestFile: string; expectedUid?: number; now?: Date },
): Promise<{ result: RetentionResult; mediaDeletionReceipt: string }> {
  const uid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail("manifest_invalid")
  let raw: unknown
  try {
    raw = JSON.parse((await readProtectedFullSyncFile(input.manifestFile, Number(uid), 64 * 1024 * 1024)).toString("utf8"))
  } catch {
    fail("manifest_invalid")
  }
  const manifest = validatePreparedManifest(raw, input.now ?? new Date())
  const { references } = await currentPreview(prisma, manifest.control)
  if (references.join("\0") !== manifest.objects.map(({ key }) => key).join("\0")) fail("manifest_drift")

  try {
    let partialDeletionObserved = false
    for (const object of manifest.objects) {
      let current = normalizeVersions(await store.listExactVersions(object.key))
      if (current.length === 0 && await store.headExists(object.key)) {
        current = [{ versionId: null, deleteMarker: false }]
      }
      const approved = new Set(object.versions.map(versionIdentity))
      if (current.some((version) => !approved.has(versionIdentity(version)))) fail("object_drift")
      if (current.length < object.versions.length) partialDeletionObserved = true
    }
    const now = input.now ?? new Date()
    if (new Date(manifest.control.expiresAt).getTime() <= now.getTime() && !partialDeletionObserved) fail("control_invalid")
    for (const object of manifest.objects) {
      for (const version of object.versions) await store.deleteExactVersion(object.key, version.versionId)
    }
    for (const object of manifest.objects) {
      if ((await store.listExactVersions(object.key)).length > 0 || await store.headExists(object.key)) fail("object_drift")
    }
  } catch (error) {
    if (error instanceof RetentionMediaPurgeError) throw error
    fail("object_store_failed")
  }

  const mediaDeletionReceipt = receiptFor(manifest)
  try {
    const result = await executeRetention(prisma, {
      organizationId: manifest.control.organizationId,
      slug: manifest.control.slug,
      policy: manifest.control.policy,
      changeId: manifest.control.changeId,
      reasonCode: manifest.control.reasonCode,
      confirmation: `PURGE ${manifest.control.slug} ${manifest.control.organizationId} ${manifest.control.policy.asOf} ${manifest.control.mediaManifestDigest}`,
      approvals: [manifest.control.requesterApprovalId, manifest.control.reviewerApprovalId],
      backupReceipt: manifest.control.backupReceipt,
      mediaDeletionReceipt,
      legalHoldClearanceReceipt: manifest.control.legalHoldClearanceReceipt,
      legalHoldCleared: true,
      mediaManifestDigest: manifest.control.mediaManifestDigest,
    })
    return { result, mediaDeletionReceipt }
  } catch {
    fail("database_purge_failed")
  }
}
