import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { putObject } = vi.hoisted(() => ({ putObject: vi.fn() }))
vi.mock("@/server/storage/s3", () => ({ putObject }))

import { handleCommercialMediaUpload } from "./commercial-media-upload-handler"

const session = { org: "org-1", sub: "agent-1", did: "device-1", role: "FIELD_AGENT" }

function request(input: { type?: string; purpose?: string; clientMediaId?: string } = {}) {
  const form = new FormData()
  form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: input.type ?? "image/jpeg" }))
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
  beforeEach(() => putObject.mockReset())

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

  it("rejects malformed ids so an upload cannot escape its object prefix", async () => {
    const response = await handleCommercialMediaUpload(request({ clientMediaId: "../../proof" }), session)
    expect(response.status).toBe(400)
    expect(putObject).not.toHaveBeenCalled()
  })
})
