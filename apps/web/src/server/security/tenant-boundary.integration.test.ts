import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { GET as getImportBatch } from "@/app/api/v1/catalog/imports/[batchId]/route"
import { GET as getMedia } from "@/app/api/media/[...path]/route"
import { signAccessToken } from "@/server/auth/jwt"
import { workerDb } from "@/server/db/client"

const suffix = `${process.pid}-${randomUUID()}`
let organizationA = ""
let organizationB = ""
let batchA = ""
let batchB = ""
let tokenA = ""
let tokenB = ""

function request(path: string, token: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

beforeAll(async () => {
  process.env.JWT_SECRET ||= `tenant-boundary-test-${randomUUID()}`
  const [orgA, orgB] = await Promise.all([
    workerDb.organization.create({
      data: { name: "Tenant boundary A", slug: `tenant-boundary-a-${suffix}` },
    }),
    workerDb.organization.create({
      data: { name: "Tenant boundary B", slug: `tenant-boundary-b-${suffix}` },
    }),
  ])
  organizationA = orgA.id
  organizationB = orgB.id

  const [createdA, createdB] = await Promise.all([
    workerDb.importBatch.create({
      data: { organizationId: organizationA, source: "csv", entityType: "products" },
    }),
    workerDb.importBatch.create({
      data: { organizationId: organizationB, source: "csv", entityType: "products" },
    }),
  ])
  batchA = createdA.id
  batchB = createdB.id

  tokenA = await signAccessToken({
    sub: `user-a-${suffix}`,
    org: organizationA,
    role: "ADMIN",
    sid: `session-a-${suffix}`,
  })
  tokenB = await signAccessToken({
    sub: `user-b-${suffix}`,
    org: organizationB,
    role: "ADMIN",
    sid: `session-b-${suffix}`,
  })
})

afterAll(async () => {
  if (organizationA || organizationB) {
    await workerDb.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB].filter(Boolean) } },
    })
  }
})

describe("tenant API boundary integration", () => {
  it("does not expose an import batch from another organization", async () => {
    const own = await getImportBatch(request(`/api/v1/catalog/imports/${batchA}`, tokenA), {
      params: Promise.resolve({ batchId: batchA }),
    })
    const foreign = await getImportBatch(
      request(`/api/v1/catalog/imports/${batchB}`, tokenA),
      { params: Promise.resolve({ batchId: batchB }) },
    )

    expect(own.status).toBe(200)
    expect((await own.json()).id).toBe(batchA)
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual({ error: "not_found" })
  })

  it("rejects a media key that belongs to another organization before storage access", async () => {
    const foreignPath = ["products", organizationB, "demo-pack.svg"]
    const foreign = await getMedia(
      request(`/api/media/${foreignPath.join("/")}`, tokenA),
      { params: Promise.resolve({ path: foreignPath }) },
    )
    const ownPath = ["products", organizationB, "demo-pack.svg"]
    const own = await getMedia(request(`/api/media/${ownPath.join("/")}`, tokenB), {
      params: Promise.resolve({ path: ownPath }),
    })

    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: "forbidden" })
    expect(own.status).toBe(200)
    expect(own.headers.get("content-type")).toContain("image/svg+xml")
  })
})
