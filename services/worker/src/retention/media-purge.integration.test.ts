import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSystemClient, previewRetention } from "@leadshelf/db"
import { afterAll, describe, expect, it } from "vitest"

import {
  executePreparedRetentionMediaPurge,
  prepareRetentionMediaPurge,
  type RetentionMediaPurgeControl,
  type RetentionObjectStore,
  type RetentionObjectVersion,
} from "./media-purge"

class FakeVersionedStore implements RetentionObjectStore {
  readonly versions = new Map<string, RetentionObjectVersion[]>()
  readonly heads = new Set<string>()
  deleteCalls = 0
  failDeleteAt: number | null = null

  async listExactVersions(key: string) {
    return (this.versions.get(key) ?? []).map((version) => ({ ...version }))
  }
  async headExists(key: string) {
    return this.heads.has(key)
  }
  async deleteExactVersion(key: string, versionId: string | null) {
    this.deleteCalls += 1
    if (this.failDeleteAt === this.deleteCalls) throw new Error("injected_store_failure")
    const current = this.versions.get(key) ?? []
    this.versions.set(key, current.filter((version) => version.versionId !== versionId))
    if (versionId === null || this.versions.get(key)?.length === 0) this.heads.delete(key)
  }
}

const prisma = createSystemClient("retention-media-purge-integration-test")
const cleanupOrganizations: string[] = []
const cleanupPaths: string[] = []
const asOf = "2026-07-19T06:00:00.000Z"
const policy = { asOf, mediaDays: 30, gpsDays: 14, auditDays: 90 }

afterAll(async () => {
  await prisma.photoSubmission.deleteMany({ where: { organizationId: { in: cleanupOrganizations } } })
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: cleanupOrganizations } } })
  await prisma.store.deleteMany({ where: { organizationId: { in: cleanupOrganizations } } })
  await prisma.user.deleteMany({ where: { organizationId: { in: cleanupOrganizations } } })
  await prisma.organization.deleteMany({ where: { id: { in: cleanupOrganizations } } })
  await prisma.$disconnect()
  await Promise.all(cleanupPaths.map((item) => rm(item, { recursive: true, force: true })))
})

async function tenant(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organization = await prisma.organization.create({
    data: { name: `Retention purge ${label}`, slug: `retention-purge-${label}-${suffix}` },
  })
  cleanupOrganizations.push(organization.id)
  const user = await prisma.user.create({
    data: { organizationId: organization.id, name: `${label} operator`, email: `${label}-${suffix}@example.test` },
  })
  const store = await prisma.store.create({
    data: { organizationId: organization.id, name: `${label} store`, code: `RP-${suffix}` },
  })
  const photoId = `retention-purge-${label}-${suffix}`
  const references = [
    `photos/${organization.id}/task-${suffix}/original.jpg`,
    `photos/${organization.id}/task-${suffix}/thumbnail.jpg`,
    `frames/${organization.id}/${photoId}/000900.jpg`,
  ]
  await prisma.photoSubmission.create({
    data: {
      id: photoId,
      organizationId: organization.id,
      storeId: store.id,
      userId: user.id,
      url: references[0]!,
      thumbnailUrl: references[1]!,
      takenAt: new Date("2026-01-01T00:00:00.000Z"),
      exif: { videoFrameExtraction: { selectedFrames: [{ key: references[2] }] } },
    },
  })
  return { organization, references }
}

describe("controlled retention media purge", () => {
  it("preflights exact versions, survives partial deletion and commits tenant-scoped DB purge", async () => {
    const target = await tenant("target")
    const neighbor = await tenant("neighbor")
    const preview = await previewRetention(prisma, {
      organizationId: target.organization.id,
      slug: target.organization.slug,
      policy,
    })
    const root = await mkdtemp(path.join(tmpdir(), "leadshelf-retention-purge-"))
    cleanupPaths.push(root)
    await chmod(root, 0o700)
    const controlFile = path.join(root, "control.json")
    const manifestFile = path.join(root, "manifest.json")
    const control: RetentionMediaPurgeControl = {
      version: 1,
      organizationId: target.organization.id,
      slug: target.organization.slug,
      changeId: "CHG-retention-purge-001",
      requesterApprovalId: "privacy-owner-approval-001",
      reviewerApprovalId: "infrastructure-owner-approval-001",
      reasonCode: "approved-retention-policy",
      backupReceipt: "backup:verified:001",
      legalHoldClearanceReceipt: "legal-hold:cleared:001",
      issuedAt: "2026-07-19T06:00:00.000Z",
      expiresAt: "2026-07-19T07:00:00.000Z",
      policy,
      mediaManifestDigest: preview.mediaManifestDigest,
      confirmation: `PURGE RETENTION ${target.organization.slug} ${target.organization.id} ${asOf} ${preview.mediaManifestDigest}`,
    }
    await writeFile(controlFile, `${JSON.stringify(control)}\n`, { mode: 0o600 })

    const objectStore = new FakeVersionedStore()
    await expect(prepareRetentionMediaPurge(prisma, objectStore, {
      controlFile,
      outputFile: manifestFile,
      now: new Date("2026-07-19T07:00:00.000Z"),
    })).rejects.toMatchObject({ code: "control_invalid" })
    await expect(prepareRetentionMediaPurge(prisma, objectStore, {
      controlFile,
      outputFile: manifestFile,
      now: new Date("2026-07-19T06:05:00.000Z"),
    })).rejects.toMatchObject({ code: "object_missing" })
    await expect(access(manifestFile)).rejects.toThrow()

    for (const [index, key] of preview.mediaReferences.entries()) {
      objectStore.versions.set(key, [
        { versionId: `v${index}-current`, deleteMarker: false },
        { versionId: `v${index}-old`, deleteMarker: false },
      ])
      objectStore.heads.add(key)
    }
    await expect(prepareRetentionMediaPurge(prisma, objectStore, {
      controlFile,
      outputFile: manifestFile,
      now: new Date("2026-07-19T06:05:00.000Z"),
    })).resolves.toEqual({ objects: 3 })
    expect((await stat(manifestFile)).mode & 0o777).toBe(0o600)
    expect((await readFile(manifestFile, "utf8")).includes(target.organization.id)).toBe(true)

    const driftKey = preview.mediaReferences[0]!
    objectStore.versions.get(driftKey)!.push({ versionId: "unapproved-new-version", deleteMarker: false })
    await expect(executePreparedRetentionMediaPurge(prisma, objectStore, { manifestFile, now: new Date("2026-07-19T06:10:00.000Z") }))
      .rejects.toMatchObject({ code: "object_drift" })
    expect(objectStore.deleteCalls).toBe(0)
    objectStore.versions.set(driftKey, objectStore.versions.get(driftKey)!.filter(({ versionId }) => versionId !== "unapproved-new-version"))

    await expect(executePreparedRetentionMediaPurge(prisma, objectStore, {
      manifestFile,
      now: new Date("2026-07-19T07:10:00.000Z"),
    })).rejects.toMatchObject({ code: "control_invalid" })
    expect(objectStore.deleteCalls).toBe(0)

    objectStore.failDeleteAt = 2
    await expect(executePreparedRetentionMediaPurge(prisma, objectStore, { manifestFile, now: new Date("2026-07-19T06:10:00.000Z") }))
      .rejects.toMatchObject({ code: "object_store_failed" })
    expect(await prisma.photoSubmission.count({ where: { organizationId: target.organization.id } })).toBe(1)

    objectStore.failDeleteAt = null
    const completed = await executePreparedRetentionMediaPurge(prisma, objectStore, { manifestFile, now: new Date("2026-07-19T07:10:00.000Z") })
    expect(completed.mediaDeletionReceipt).toMatch(/^s3-purge:v1:[a-f0-9]{64}$/)
    expect(completed.result.deleted.mediaRows).toBe(1)
    expect(completed.result.legalHoldClearanceReceipt).toBe(control.legalHoldClearanceReceipt)
    expect(await prisma.photoSubmission.count({ where: { organizationId: target.organization.id } })).toBe(0)
    expect(await prisma.photoSubmission.count({ where: { organizationId: neighbor.organization.id } })).toBe(1)
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: target.organization.id, action: "retention.execute" },
      orderBy: { createdAt: "desc" },
    })
    expect(audit).toMatchObject({ entityId: target.organization.id })
    expect(audit.payload).toMatchObject({
      changeId: control.changeId,
      reasonCode: control.reasonCode,
      backupReceipt: control.backupReceipt,
      legalHoldClearanceReceipt: control.legalHoldClearanceReceipt,
      mediaDeletionReceipt: completed.mediaDeletionReceipt,
      approvalIds: [control.requesterApprovalId, control.reviewerApprovalId],
    })
    for (const key of preview.mediaReferences) {
      expect(await objectStore.listExactVersions(key)).toEqual([])
      expect(await objectStore.headExists(key)).toBe(false)
    }
  })
})
