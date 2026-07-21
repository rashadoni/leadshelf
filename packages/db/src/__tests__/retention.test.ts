import { afterAll, describe, expect, it } from "vitest"
import { createSystemClient } from "../tenant-client"
import { executeRetention, previewRetention, redactLocationData } from "../retention"

const prisma = createSystemClient("retention-integration-test")
const organizationIds: string[] = []
const asOf = "2026-07-18T12:00:00.000Z"
const old = new Date("2026-01-01T00:00:00.000Z")
const recent = new Date("2026-07-17T00:00:00.000Z")
const policy = { asOf, mediaDays: 30, gpsDays: 14, auditDays: 90 }

afterAll(async () => {
  await prisma.goldenReference.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.planogramVersion.deleteMany({ where: { planogram: { organizationId: { in: organizationIds } } } })
  await prisma.planogram.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.photoSubmission.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.agentLocation.deleteMany({ where: { agent: { organizationId: { in: organizationIds } } } })
  await prisma.visit.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.fieldAgent.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.store.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } })
  await prisma.$disconnect()
})

async function fixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organization = await prisma.organization.create({
    data: { name: `Retention ${label}`, slug: `retention-${label}-${suffix}` },
  })
  organizationIds.push(organization.id)
  const user = await prisma.user.create({
    data: { organizationId: organization.id, name: `${label} user`, email: `${label}-${suffix}@example.test` },
  })
  const store = await prisma.store.create({
    data: { organizationId: organization.id, name: `${label} store`, code: `R-${suffix}` },
  })
  const agent = await prisma.fieldAgent.create({ data: { organizationId: organization.id, userId: user.id } })
  const oldPhotoId = `retention-old-${suffix}`
  const visit = await prisma.visit.create({
    data: {
      organizationId: organization.id, agentId: agent.id, storeId: store.id,
      checkInAt: old, checkInLat: 40.4, checkInLng: 49.8,
      anomalyFlags: { geofence: { distanceM: 25, outside: false }, duration: { minutes: 10 } },
    },
  })
  await prisma.agentLocation.createMany({
    data: [
      { agentId: agent.id, latitude: 40.4, longitude: 49.8, recordedAt: old },
      { agentId: agent.id, latitude: 40.5, longitude: 49.9, recordedAt: recent },
    ],
  })
  await prisma.photoSubmission.createMany({
    data: [
      {
        id: oldPhotoId,
        organizationId: organization.id, storeId: store.id, userId: user.id, visitId: visit.id,
        url: `photos/${organization.id}/old.jpg`, thumbnailUrl: `photos/${organization.id}/old-thumb.jpg`,
        takenAt: old,
        exif: {
          GPSLatitude: 40.4, GPSLongitude: 49.8, Make: "LeadShelf",
          videoFrameExtraction: { selectedFrames: [{ key: `frames/${organization.id}/${oldPhotoId}/000900.jpg` }] },
        },
      },
      {
        organizationId: organization.id, storeId: store.id, userId: user.id,
        url: `photos/${organization.id}/recent.jpg`, takenAt: recent,
        exif: { GPSLatitude: 40.5, GPSLongitude: 49.9, Make: "LeadShelf" },
      },
    ],
  })
  await prisma.auditLog.createMany({
    data: [
      { organizationId: organization.id, action: "old", entityType: "fixture", createdAt: old },
      { organizationId: organization.id, action: "recent", entityType: "fixture", createdAt: recent },
    ],
  })
  return { organization, visit, oldPhotoId }
}

describe("retention purge", () => {
  it("recursively removes location values and preserves unrelated metadata", () => {
    expect(redactLocationData({
      GPSLatitude: 40.4,
      nested: { gps: { latitude: 40.4 }, duration: { minutes: 10 } },
      Make: "LeadShelf",
    })).toEqual({ nested: { duration: { minutes: 10 } }, Make: "LeadShelf" })
  })

  it("requires explicit policy and destructive-operation safeguards", async () => {
    const { organization, oldPhotoId } = await fixture("guard")
    await expect(previewRetention(prisma, {
      organizationId: organization.id, slug: organization.slug,
      policy: { ...policy, mediaDays: Number.NaN },
    })).rejects.toThrow("mediaDays")
    const planogram = await prisma.planogram.create({ data: { organizationId: organization.id, name: "Protected reference" } })
    const version = await prisma.planogramVersion.create({ data: { planogramId: planogram.id, versionNumber: 1 } })
    await prisma.goldenReference.create({
      data: {
        organizationId: organization.id,
        planogramVersionId: version.id,
        photoSubmissionId: oldPhotoId,
        imageUrl: `photos/${organization.id}/old.jpg`,
      },
    })
    const protectedPreview = await previewRetention(prisma, {
      organizationId: organization.id, slug: organization.slug, policy,
    })
    expect(protectedPreview.affected.goldenReferenceBlockedRows).toBe(1)
    expect(protectedPreview.mediaReferences).toEqual([])
    const base = {
      organizationId: organization.id, slug: organization.slug, policy,
      changeId: "CHG-retention-guard", reasonCode: "approved-retention-policy",
      confirmation: `PURGE ${organization.slug} ${organization.id} ${asOf} ${protectedPreview.mediaManifestDigest}`,
      approvals: ["privacy-owner", "infrastructure-owner"],
      backupReceipt: "backup:verified", mediaDeletionReceipt: "media:deleted",
      legalHoldClearanceReceipt: "legal-hold:cleared",
      legalHoldCleared: true, mediaManifestDigest: protectedPreview.mediaManifestDigest,
    }
    await expect(executeRetention(prisma, { ...base, approvals: ["same", "same"] })).rejects.toThrow("два разных")
    await expect(executeRetention(prisma, { ...base, legalHoldCleared: false })).rejects.toThrow("legal hold")
    await expect(executeRetention(prisma, { ...base, legalHoldClearanceReceipt: "" })).rejects.toThrow("legalHoldClearanceReceipt")
    await expect(executeRetention(prisma, { ...base, confirmation: "PURGE wrong" })).rejects.toThrow("confirmation")
    await expect(executeRetention(prisma, base)).rejects.toThrow("GoldenReference")
  })

  it("purges expired target data and preserves recent and neighboring tenant data", async () => {
    const target = await fixture("target")
    const neighbor = await fixture("neighbor")
    const preview = await previewRetention(prisma, {
      organizationId: target.organization.id, slug: target.organization.slug, policy,
    })
    expect(preview.affected).toMatchObject({
      mediaRows: 1, gpsLocationRows: 1, gpsVisitRows: 1, gpsPhotoMetadataRows: 1,
      auditRows: 1, goldenReferenceBlockedRows: 0,
    })
    expect(preview.mediaReferences.some((key) =>
      key.startsWith(`frames/${target.organization.id}/retention-old-`),
    )).toBe(true)
    const result = await executeRetention(prisma, {
      organizationId: target.organization.id, slug: target.organization.slug, policy,
      changeId: "CHG-retention-target", reasonCode: "approved-retention-policy",
      confirmation: `PURGE ${target.organization.slug} ${target.organization.id} ${asOf} ${preview.mediaManifestDigest}`,
      approvals: ["privacy-owner", "infrastructure-owner"],
      backupReceipt: "backup:verified", mediaDeletionReceipt: "media:deleted",
      legalHoldClearanceReceipt: "legal-hold:cleared",
      legalHoldCleared: true, mediaManifestDigest: preview.mediaManifestDigest,
    })
    expect(result.deleted).toEqual({ mediaRows: 1, gpsLocationRows: 1, auditRows: 1 })
    expect(await prisma.photoSubmission.count({ where: { organizationId: target.organization.id } })).toBe(1)
    expect(await prisma.agentLocation.count({ where: { agent: { organizationId: target.organization.id } } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { organizationId: target.organization.id } })).toBe(2)
    expect(await prisma.auditLog.count({
      where: { organizationId: target.organization.id, id: result.auditEventId, action: "retention.execute" },
    })).toBe(1)
    const visit = await prisma.visit.findFirstOrThrow({ where: { id: target.visit.id } })
    expect(visit).toMatchObject({ checkInLat: null, checkInLng: null })
    expect(visit.anomalyFlags).toEqual({ geofence: { outside: false }, duration: { minutes: 10 } })
    expect(await prisma.photoSubmission.count({ where: { organizationId: neighbor.organization.id } })).toBe(2)
    expect(await prisma.agentLocation.count({ where: { agent: { organizationId: neighbor.organization.id } } })).toBe(2)
    expect(await prisma.auditLog.count({ where: { organizationId: neighbor.organization.id } })).toBe(2)
  })
})
