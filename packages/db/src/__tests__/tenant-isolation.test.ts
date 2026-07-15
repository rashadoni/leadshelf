import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { PrismaClient } from "@prisma/client"
import { createTenantClient } from "../tenant-client.ts"

// Интеграционные тесты против реального Postgres (127.0.0.1:55432 из .env).
// Setup идет через голый PrismaClient (аналог system client), проверки —
// через tenant client.

const prisma = new PrismaClient()
let orgA: string
let orgB: string
let productB: string

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "test-iso-" } } })
  const a = await prisma.organization.create({ data: { name: "Iso A", slug: "test-iso-a" } })
  const b = await prisma.organization.create({ data: { name: "Iso B", slug: "test-iso-b" } })
  orgA = a.id
  orgB = b.id
  await prisma.product.create({
    data: { organizationId: orgA, sku: "A-1", name: "Product A1" },
  })
  const pb = await prisma.product.create({
    data: { organizationId: orgB, sku: "B-1", name: "Product B1" },
  })
  productB = pb.id
})

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: "test-iso-" } } })
  await prisma.$disconnect()
})

describe("tenant isolation", () => {
  test("findMany тенанта A никогда не видит товары B", async () => {
    const db = createTenantClient(prisma, orgA)
    const products = await db.product.findMany()
    expect(products).toHaveLength(1)
    expect(products[0]!.sku).toBe("A-1")
  })

  test("findFirst по id чужого товара возвращает null, не данные B", async () => {
    const db = createTenantClient(prisma, orgA)
    const stolen = await db.product.findFirst({ where: { id: productB } })
    expect(stolen).toBeNull()
  })

  test("findUnique запрещен (unique-ключ не скоупится)", async () => {
    const db = createTenantClient(prisma, orgA)
    await expect(db.product.findUnique({ where: { id: productB } })).rejects.toThrow(
      /findUnique.*запрещен/,
    )
  })

  test("create инжектит organizationId и отвергает чужой", async () => {
    const db = createTenantClient(prisma, orgA)
    // extension сам инжектит organizationId, поэтому каст мимо Prisma-типов
    const created = await db.product.create({
      data: { sku: "A-2", name: "Product A2" } as never,
    })
    expect(created.organizationId).toBe(orgA)
    await expect(
      db.product.create({
        data: { organizationId: orgB, sku: "EVIL", name: "Evil" } as never,
      }),
    ).rejects.toThrow(/чужим organizationId/)
  })

  test("nested write отклоняется (extension его не скоупит)", async () => {
    const db = createTenantClient(prisma, orgA)
    await expect(
      db.planogram.create({
        data: {
          name: "P",
          versions: { create: { versionNumber: 1 } },
        } as never,
      }),
    ).rejects.toThrow(/nested write/)
  })

  test("дочерняя модель без organizationId блокируется целиком", async () => {
    const db = createTenantClient(prisma, orgA)
    await expect(db.planogramPlacement.findMany()).rejects.toThrow(/доменный репозиторий/)
    await expect(db.equipmentShelf.findMany()).rejects.toThrow(/доменный репозиторий/)
  })

  test("updateMany/deleteMany/count скоупятся: тенант A не задевает B", async () => {
    const db = createTenantClient(prisma, orgA)
    const upd = await db.product.updateMany({
      where: { sku: "B-1" },
      data: { name: "hacked" },
    })
    expect(upd.count).toBe(0)
    const untouched = await prisma.product.findUniqueOrThrow({ where: { id: productB } })
    expect(untouched.name).toBe("Product B1")
    expect(await db.product.count()).toBeGreaterThanOrEqual(1)
    const del = await db.product.deleteMany({ where: { sku: "B-1" } })
    expect(del.count).toBe(0)
  })

  test("raw SQL и Organization недоступны из tenant-клиента", async () => {
    const db = createTenantClient(prisma, orgA)
    expect(() => (db as never as Record<string, unknown>).$queryRaw).toThrow(/запрещен/)
    expect(() => (db as never as Record<string, unknown>).$executeRawUnsafe).toThrow(/запрещен/)
    expect(() => (db as never as Record<string, unknown>).organization).toThrow(/Organization/)
  })

  test("update/delete/upsert по unique-ключу запрещены", async () => {
    const db = createTenantClient(prisma, orgA)
    await expect(
      db.product.update({ where: { id: productB }, data: { name: "x" } }),
    ).rejects.toThrow(/запрещен/)
    await expect(db.product.delete({ where: { id: productB } })).rejects.toThrow(/запрещен/)
  })
})
