import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  consumeRateLimit,
  deleteObject,
  emitProductEvent,
  putObject,
  resolveCaptureRetakesForStep,
  workerDb,
} = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  deleteObject: vi.fn(),
  emitProductEvent: vi.fn(),
  putObject: vi.fn(),
  resolveCaptureRetakesForStep: vi.fn(),
  workerDb: {
    photoSubmission: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
    humanReview: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/server/security/rate-limit", () => ({ consumeRateLimit }))
vi.mock("@/server/storage/s3", () => ({ deleteObject, putObject }))
vi.mock("@/server/db/client", () => ({ workerDb }))
vi.mock("@leadshelf/db", () => ({ emitProductEvent, resolveCaptureRetakesForStep }))

import { handleMobilePhotoUpload } from "./photo-upload-handler"

const session = { org: "org-1", sub: "agent-1", did: "device-1", role: "FIELD_AGENT" }

function request(bytes: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0x00])) {
  const form = new FormData()
  const fileBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(fileBytes).set(bytes)
  form.append("file", new File([fileBytes], "proof.jpg", { type: "image/jpeg" }))
  form.append("clientPhotoId", "photo-12345678")
  form.append("taskId", "task-1")
  form.append("takenAt", "2026-07-19T10:00:00.000Z")
  form.append("mediaType", "photo")
  return new NextRequest("http://localhost/api/v1/mobile/photos/upload", {
    method: "POST",
    headers: { "x-leadshelf-protocol": "1" },
    body: form,
  })
}

describe("shared mobile photo upload handler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    workerDb.photoSubmission.findFirst.mockResolvedValue(null)
    workerDb.task.findFirst.mockResolvedValue({
      id: "task-1",
      storeId: "store-1",
      planogramVersionId: "version-1",
      store: { latitude: null, longitude: null },
    })
  })

  it("rejects a device over its durable limit before multipart parsing or storage", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 })
    const req = new NextRequest("http://localhost/api/v1/internal/field/photos/upload", {
      method: "POST",
      headers: { "x-leadshelf-protocol": "1", "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    })

    const response = await handleMobilePhotoUpload(req, session)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("17")
    expect(putObject).not.toHaveBeenCalled()
    expect(workerDb.photoSubmission.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a MIME/signature mismatch before database or object storage I/O", async () => {
    const response = await handleMobilePhotoUpload(request(new Uint8Array([1, 2, 3, 4])), session)

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "content_signature_mismatch" })
    expect(putObject).not.toHaveBeenCalled()
    expect(workerDb.photoSubmission.findFirst).not.toHaveBeenCalled()
  })

  it("returns a privacy-safe retryable response when object storage fails", async () => {
    putObject.mockRejectedValue(new Error("private provider details"))

    const response = await handleMobilePhotoUpload(request(), session)

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toEqual({ error: "storage_unavailable" })
    expect(workerDb.$transaction).not.toHaveBeenCalled()
    const key = putObject.mock.calls[0]?.[0] as string
    expect(key).toMatch(/^photos\/org-1\/task-1\/photo-12345678-[0-9a-f-]{36}\.jpg$/)
  })

  it("deletes only its unique attempted object when database persistence fails", async () => {
    const databaseError = new Error("database failed")
    putObject.mockResolvedValue(undefined)
    workerDb.$transaction.mockRejectedValue(databaseError)
    deleteObject.mockResolvedValue(undefined)

    await expect(handleMobilePhotoUpload(request(), session)).rejects.toBe(databaseError)

    const key = putObject.mock.calls[0]?.[0] as string
    expect(deleteObject).toHaveBeenCalledOnce()
    expect(deleteObject).toHaveBeenCalledWith(key)
  })
})
