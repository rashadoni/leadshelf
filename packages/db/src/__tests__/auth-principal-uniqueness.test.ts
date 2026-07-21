import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { createSystemClient } from "../tenant-client"

const db = createSystemClient("authentication-principal-uniqueness-integration-test")
const organizationIds: string[] = []

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } })
  await db.$disconnect()
})

describe("normalized authentication principal uniqueness", () => {
  it("rejects case-only slug, email and employee-code duplicates at the database boundary", async () => {
    const suffix = randomUUID().slice(0, 8)
    const slug = `principal-${suffix}`
    const organization = await db.organization.create({
      data: {
        name: "Principal invariant",
        slug,
        users: {
          create: {
            name: "First principal",
            email: "Mixed.Email@Example.test",
            employeeCode: "FIELD-007",
          },
        },
      },
      select: { id: true },
    })
    organizationIds.push(organization.id)
    await expect(db.organization.create({
      data: { name: "Case collision", slug: slug.toUpperCase() },
    })).rejects.toMatchObject({ code: "P2002" })
    await expect(db.user.create({
      data: {
        organizationId: organization.id,
        name: "Email collision",
        email: "mixed.email@example.test",
      },
    })).rejects.toMatchObject({ code: "P2002" })
    await expect(db.user.create({
      data: {
        organizationId: organization.id,
        name: "Employee collision",
        employeeCode: "field-007",
      },
    })).rejects.toMatchObject({ code: "P2002" })
  })
})
