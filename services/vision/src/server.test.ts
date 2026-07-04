import { describe, expect, it } from "vitest"
import { VISION_PROTOCOL_VERSION, visionHealthResponseSchema } from "@leadshelf/api-contracts/vision/v1"
import { STUB_MODEL_VERSION, STUB_PROVIDER } from "./provider"
import { handleVisionHttpRequest } from "./server"

describe("vision HTTP handler", () => {
  it("returns health metadata without requiring a provider call", async () => {
    const result = await handleVisionHttpRequest({
      method: "GET",
      url: "/health",
      body: null,
    })

    expect(result.status).toBe(200)
    expect(visionHealthResponseSchema.parse(result.body)).toEqual({
      ok: true,
      provider: STUB_PROVIDER,
      modelVersion: STUB_MODEL_VERSION,
      protocolVersion: VISION_PROTOCOL_VERSION,
    })
  })

  it("returns 400 for invalid scan requests", async () => {
    const result = await handleVisionHttpRequest({
      method: "POST",
      url: "/v1/scan",
      body: { protocolVersion: VISION_PROTOCOL_VERSION },
    })

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ error: "invalid_request" })
  })

  it("routes valid scan requests through the provider and validates the response schema", async () => {
    const result = await handleVisionHttpRequest({
      method: "POST",
      url: "/v1/scan",
      body: {
        protocolVersion: VISION_PROTOCOL_VERSION,
        organizationId: "org-a",
        planogramVersionId: "version-a",
        photoSubmissionId: "photo-a",
        photoUrl: "photos/org-a/task-a/photo-a.jpg",
        slots: [],
      },
    })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      protocolVersion: VISION_PROTOCOL_VERSION,
      provider: STUB_PROVIDER,
      modelVersion: STUB_MODEL_VERSION,
      status: "failed",
    })
  })

  it("returns 404 for unknown routes", async () => {
    const result = await handleVisionHttpRequest({
      method: "GET",
      url: "/unknown",
      body: null,
    })

    expect(result).toEqual({ status: 404, body: { error: "not_found" } })
  })
})
