import { createDecipheriv, randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { executeDsarExport, previewDsarExport } from "../dsar"
import { createSystemClient } from "../tenant-client"

const prisma = createSystemClient("dsar-integration-test")
const organizationIds: string[] = []
const tempDirectories: string[] = []

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.authSession.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } })
  await Promise.all(tempDirectories.map((path) => rm(path, { recursive: true, force: true })))
  await prisma.$disconnect()
})

async function fixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organization = await prisma.organization.create({ data: { name: `DSAR ${label}`, slug: `dsar-${label}-${suffix}` } })
  organizationIds.push(organization.id)
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: `${label} private name`,
      email: `${label}-${suffix}@example.test`,
      passwordHash: `password-hash-${suffix}`,
    },
  })
  await prisma.authSession.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      refreshFamilyId: `family-${suffix}`,
      refreshJti: `jti-${suffix}`,
      refreshTokenHash: `refresh-hash-${suffix}`,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      userAgent: "DSAR test device",
    },
  })
  const device = await prisma.mobileDevice.create({
    data: { userId: user.id, platform: "android", deviceName: `${label} phone`, pushToken: `push-secret-${suffix}` },
  })
  await prisma.outboxOperation.create({
    data: {
      deviceId: device.id,
      clientOpId: `op-${suffix}`,
      kind: "fixture",
      payload: {
        authorization: `bearer-${suffix}`,
        apiKey: `api-key-${suffix}`,
        pin: `pin-${suffix}`,
        sessionId: `session-${suffix}`,
        harmless: `allowed-${suffix}`,
      },
    },
  })
  return { organization, user, suffix }
}

function decrypt(serialized: string, key: Buffer): string {
  const envelope = JSON.parse(serialized) as { iv: string; authTag: string; ciphertext: string }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"))
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

describe("controlled DSAR export", () => {
  it("rejects a neighboring tenant subject and never returns their profile", async () => {
    const target = await fixture("target-guard")
    const neighbor = await fixture("neighbor-guard")
    await expect(previewDsarExport(prisma, {
      organizationId: target.organization.id,
      slug: target.organization.slug,
      subjectUserId: neighbor.user.id,
      requestId: "DSAR-guard",
    })).rejects.toThrow("не принадлежит организации")
  })

  it("exports an encrypted, tenant-scoped bundle without credential material", async () => {
    const target = await fixture("target-export")
    const neighbor = await fixture("neighbor-export")
    const request = {
      organizationId: target.organization.id,
      slug: target.organization.slug,
      subjectUserId: target.user.id,
      requestId: "DSAR-2026-001",
    }
    const preview = await previewDsarExport(prisma, request)
    expect(preview.categories).toMatchObject({ user: 1, authSessions: 1, mobileDevices: 1 })
    expect(JSON.stringify(preview)).not.toContain(target.user.email as string)
    expect(JSON.stringify(preview)).not.toContain(target.user.id)
    expect(JSON.stringify(preview)).not.toContain(request.requestId)

    const directory = await mkdtemp(join(tmpdir(), "leadshelf-dsar-"))
    tempDirectories.push(directory)
    const outputPath = join(directory, "export.enc.json")
    const key = randomBytes(32)
    const result = await executeDsarExport(prisma, {
      ...request,
      confirmation: `EXPORT ${request.slug} ${request.organizationId} ${request.subjectUserId} ${request.requestId} ${preview.manifestDigest}`,
      approvals: ["privacy-owner:ticket-1", "security-owner:ticket-2"],
      legalBasisReceipt: "privacy-request:verified",
      manifestDigest: preview.manifestDigest,
      outputPath,
      encryptionKey: key,
    })
    const encrypted = await readFile(outputPath, "utf8")
    expect(encrypted).not.toContain(target.user.email as string)
    const plaintext = decrypt(encrypted, key)
    expect(plaintext).toContain(target.user.email as string)
    expect(plaintext).not.toContain(`password-hash-${target.suffix}`)
    expect(plaintext).not.toContain(`refresh-hash-${target.suffix}`)
    expect(plaintext).not.toContain(`jti-${target.suffix}`)
    expect(plaintext).not.toContain(`push-secret-${target.suffix}`)
    expect(plaintext).not.toContain(`bearer-${target.suffix}`)
    expect(plaintext).not.toContain(`api-key-${target.suffix}`)
    expect(plaintext).not.toContain(`pin-${target.suffix}`)
    expect(plaintext).not.toContain(`session-${target.suffix}`)
    expect(plaintext).toContain(`allowed-${target.suffix}`)
    expect(plaintext).not.toContain(neighbor.user.email as string)
    expect(result.encryption).toBe("AES-256-GCM")
    expect(await prisma.auditLog.count({ where: { id: result.auditEventId, organizationId: target.organization.id, action: "dsar.export" } })).toBe(1)

    const nextPreview = await previewDsarExport(prisma, request)
    await expect(executeDsarExport(prisma, {
      ...request,
      confirmation: `EXPORT ${request.slug} ${request.organizationId} ${request.subjectUserId} ${request.requestId} ${nextPreview.manifestDigest}`,
      approvals: ["privacy-owner:ticket-1", "security-owner:ticket-2"],
      legalBasisReceipt: "privacy-request:verified",
      manifestDigest: nextPreview.manifestDigest,
      outputPath,
      encryptionKey: key,
    })).rejects.toMatchObject({ code: "EEXIST" })

    await expect(executeDsarExport(prisma, {
      ...request,
      confirmation: `EXPORT ${request.slug} ${request.organizationId} ${request.subjectUserId} ${request.requestId} ${preview.manifestDigest}`,
      approvals: ["one", "one"],
      legalBasisReceipt: "privacy-request:verified",
      manifestDigest: preview.manifestDigest,
      outputPath: join(directory, "rejected.enc.json"),
      encryptionKey: key,
    })).rejects.toThrow("два разных")
  })
})
