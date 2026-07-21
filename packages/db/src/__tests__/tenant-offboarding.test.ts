import { afterAll, describe, expect, it } from "vitest"
import { createSystemClient } from "../tenant-client"
import { deleteTenantData, previewTenantOffboarding } from "../tenant-offboarding"

const prisma = createSystemClient("tenant-offboarding-integration-test")
const createdOrganizationIds: string[] = []

afterAll(async () => {
  await prisma.authSession.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } })
  await prisma.$disconnect()
})

async function fixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organization = await prisma.organization.create({
    data: { name: `Offboarding ${label}`, slug: `offboarding-${label}-${suffix}` },
  })
  createdOrganizationIds.push(organization.id)
  const user = await prisma.user.create({
    data: { organizationId: organization.id, name: `${label} user`, email: `${label}-${suffix}@example.test` },
  })
  const product = await prisma.product.create({
    data: { organizationId: organization.id, sku: `SKU-${label}-${suffix}`, name: `${label} product` },
  })
  await prisma.productImage.create({ data: { productId: product.id, url: `s3://media/${organization.id}/product.jpg` } })
  await prisma.authSession.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      refreshFamilyId: `family-${suffix}`,
      refreshJti: `jti-${suffix}`,
      refreshTokenHash: `hash-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  return { organization, user, product }
}

describe("tenant offboarding", () => {
  it("requires exact identity, two approvals and external deletion receipts", async () => {
    const { organization } = await fixture("guard")
    const base = {
      organizationId: organization.id,
      slug: organization.slug,
      confirmation: `DELETE ${organization.slug} ${organization.id}`,
      approvals: ["privacy-owner", "infrastructure-owner"],
      backupReceipt: "backup:verified:guard",
      mediaDeletionReceipt: "media:deleted:guard",
      legalHoldCleared: true,
    }
    await expect(deleteTenantData(prisma, { ...base, confirmation: "DELETE wrong" })).rejects.toThrow("confirmation")
    await expect(deleteTenantData(prisma, { ...base, approvals: ["same", "same"] })).rejects.toThrow("два разных")
    await expect(deleteTenantData(prisma, { ...base, legalHoldCleared: false })).rejects.toThrow("legal hold")
    expect(await prisma.organization.count({ where: { id: organization.id } })).toBe(1)
  })

  it("previews media, deletes one tenant transactionally and preserves another", async () => {
    const target = await fixture("target")
    const neighbor = await fixture("neighbor")
    const preview = await previewTenantOffboarding(prisma, {
      organizationId: target.organization.id,
      slug: target.organization.slug,
    })
    expect(preview.totalRows).toBeGreaterThanOrEqual(3)
    expect(preview.mediaReferences).toEqual([`s3://media/${target.organization.id}/product.jpg`])

    const result = await deleteTenantData(prisma, {
      organizationId: target.organization.id,
      slug: target.organization.slug,
      confirmation: `DELETE ${target.organization.slug} ${target.organization.id}`,
      approvals: ["privacy-owner", "infrastructure-owner"],
      backupReceipt: "backup:verified:target",
      mediaDeletionReceipt: "media:deleted:target",
      legalHoldCleared: true,
    })
    expect(result.deletedRows).toBeGreaterThanOrEqual(4)
    expect(await prisma.organization.count({ where: { id: target.organization.id } })).toBe(0)
    expect(await prisma.authSession.count({ where: { organizationId: target.organization.id } })).toBe(0)
    expect(await prisma.organization.count({ where: { id: neighbor.organization.id } })).toBe(1)
    expect(await prisma.user.count({ where: { id: neighbor.user.id } })).toBe(1)
    expect(await prisma.product.count({ where: { id: neighbor.product.id } })).toBe(1)
  })
})
