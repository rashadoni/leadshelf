import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { acquireMediaUploadAdmission, putObject } = vi.hoisted(() => ({
  acquireMediaUploadAdmission: vi.fn(),
  putObject: vi.fn(),
}))
vi.mock("@/server/mobile/media-upload-admission", () => ({ acquireMediaUploadAdmission }))
vi.mock("@/server/storage/s3", () => ({ putObject }))

import { handleCommercialMediaUpload } from "./commercial-media-upload-handler"

const session = { org: "org-1", sub: "agent-1", did: "device-1", role: "FIELD_AGENT" }

function request(input: {
  bytes?: Uint8Array
  type?: string
  purpose?: string
  clientMediaId?: string
} = {}) {
  const form = new FormData()
  const bytes = input.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0x00])
  const fileBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(fileBytes).set(bytes)
  form.append("file", new File([fileBytes], "proof.jpg", { type: input.type ?? "image/jpeg" }))
  form.append("clientMediaId", input.clientMediaId ?? "media-12345678")
  form.append("purpose", input.purpose ?? "PROMOTION_PROOF")
  form.append("takenAt", "2026-07-16T10:00:00.000Z")
  return new NextRequest("http://localhost/api/v1/internal/field/commercial-media/upload", {
    method: "POST",
    headers: { "x-leadshelf-protocol": "1" },
    body: form,
  })
}

describe("commercial media upload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acquireMediaUploadAdmission.mockResolvedValue({ ok: true, release: vi.fn() })
  })

  it("stores a deterministic tenant and agent scoped proof key", async () => {
    putObject.mockResolvedValue(undefined)
    const response = await handleCommercialMediaUpload(request(), session)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      mediaId: "media-12345678",
      key: "commercial-media/org-1/agent-1/promotion/media-12345678.jpg",
      purpose: "PROMOTION_PROOF",
    })
    expect(putObject).toHaveBeenCalledWith(
      "commercial-media/org-1/agent-1/promotion/media-12345678.jpg",
      expect.any(Buffer),
      "image/jpeg",
    )
  })

  it("rejects unsupported content before storage I/O", async () => {
    const response = await handleCommercialMediaUpload(request({ type: "application/pdf" }), session)
    expect(response.status).toBe(415)
    expect(putObject).not.toHaveBeenCalled()
  })

  it("rejects an exhausted device budget before multipart parsing or storage", async () => {
    acquireMediaUploadAdmission.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": "19" } },
      ),
    })
    const req = new NextRequest("http://localhost/api/v1/internal/field/commercial-media/upload", {
      method: "POST",
      headers: { "x-leadshelf-protocol": "1", "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    })

    const response = await handleCommercialMediaUpload(req, session)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("19")
    expect(putObject).not.toHaveBeenCalled()
  })

  it("rejects a declared image whose magic bytes do not match", async () => {
    const response = await handleCommercialMediaUpload(
      request({ bytes: new Uint8Array([1, 2, 3, 4]) }),
      session,
    )

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: "content_signature_mismatch" })
    expect(putObject).not.toHaveBeenCalled()
  })

  it("suppresses private storage errors and returns a retryable response", async () => {
    putObject.mockRejectedValue(new Error("private storage details"))

    const response = await handleCommercialMediaUpload(request(), session)

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toEqual({ error: "storage_unavailable" })
  })

  it("rejects malformed ids so an upload cannot escape its object prefix", async () => {
    const response = await handleCommercialMediaUpload(request({ clientMediaId: "../../proof" }), session)
    expect(response.status).toBe(400)
    expect(putObject).not.toHaveBeenCalled()
  })
})
