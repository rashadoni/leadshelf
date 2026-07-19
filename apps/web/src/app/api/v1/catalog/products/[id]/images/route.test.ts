import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const {
  acquireMediaUploadAdmission,
  deleteObject,
  forbidden,
  productFindFirst,
  productImageCount,
  productImageCreate,
  putObject,
  requireApiSession,
  tenantDb,
  unauthorized,
  workerDb,
} = vi.hoisted(() => {
  const productFindFirst = vi.fn()
  const productImageCount = vi.fn()
  const productImageCreate = vi.fn()
  return {
    acquireMediaUploadAdmission: vi.fn(),
    deleteObject: vi.fn(),
    forbidden: vi.fn(),
    productFindFirst,
    productImageCount,
    productImageCreate,
    putObject: vi.fn(),
    requireApiSession: vi.fn(),
    tenantDb: vi.fn(() => ({ product: { findFirst: productFindFirst } })),
    unauthorized: vi.fn(),
    workerDb: {
      productImage: {
        count: productImageCount,
        create: productImageCreate,
      },
    },
  }
})

vi.mock("@/server/http/api-guard", () => ({ requireApiSession, unauthorized, forbidden }))
vi.mock("@/server/db/client", () => ({ tenantDb, workerDb }))
vi.mock("@/server/mobile/media-upload-admission", () => ({ acquireMediaUploadAdmission }))
vi.mock("@/server/storage/s3", () => ({
  deleteObject,
  productImageKey: () => "products/org-1/product-1/attempt.jpg",
  putObject,
}))

import { POST } from "./route"

const params = { params: Promise.resolve({ id: "product-1" }) }

function request(bytes: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0x00])) {
  const form = new FormData()
  const fileBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(fileBytes).set(bytes)
  form.append("file", new File([fileBytes], "product.jpg", { type: "image/jpeg" }))
  return new NextRequest("http://localhost/api/v1/catalog/products/product-1/images", {
    method: "POST",
    body: form,
  })
}

describe("catalog product image upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireApiSession.mockResolvedValue({
      org: "org-1",
      sub: "user-1",
      role: "ADMIN",
    })
    acquireMediaUploadAdmission.mockResolvedValue({ ok: true, release: vi.fn() })
    productFindFirst.mockResolvedValue({ id: "product-1" })
    productImageCount.mockResolvedValue(0)
    productImageCreate.mockResolvedValue({ id: "image-1" })
    putObject.mockResolvedValue(undefined)
    deleteObject.mockResolvedValue(undefined)
  })

  it("rejects an exhausted tenant/user budget before product or multipart reads", async () => {
    acquireMediaUploadAdmission.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": "31" } },
      ),
    })
    const req = new NextRequest("http://localhost/api/v1/catalog/products/product-1/images", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    })

    const response = await POST(req, params)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("31")
    expect(acquireMediaUploadAdmission).toHaveBeenCalledWith(
      "catalog-image-upload",
      "org-1:user-1",
      { max: 60, windowMs: 60 * 60_000 },
    )
    expect(productFindFirst).not.toHaveBeenCalled()
    expect(putObject).not.toHaveBeenCalled()
  })

  it("rejects a MIME/signature mismatch before object or image-row writes", async () => {
    const response = await POST(request(new Uint8Array([1, 2, 3, 4])), params)

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "content_signature_mismatch" })
    expect(putObject).not.toHaveBeenCalled()
    expect(productImageCount).not.toHaveBeenCalled()
    expect(productImageCreate).not.toHaveBeenCalled()
  })

  it("returns a privacy-safe retryable response when storage fails", async () => {
    putObject.mockRejectedValue(new Error("private provider details"))

    const response = await POST(request(), params)

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toEqual({ error: "storage_unavailable" })
    expect(productImageCreate).not.toHaveBeenCalled()
  })

  it("deletes the exact attempted object if the image row cannot be persisted", async () => {
    const databaseError = new Error("database failed")
    productImageCreate.mockRejectedValue(databaseError)

    await expect(POST(request(), params)).rejects.toBe(databaseError)

    expect(deleteObject).toHaveBeenCalledOnce()
    expect(deleteObject).toHaveBeenCalledWith("products/org-1/product-1/attempt.jpg")
  })
})
