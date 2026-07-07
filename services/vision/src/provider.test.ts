import { describe, expect, it } from "vitest"
import {
  VISION_PROTOCOL_VERSION,
  visionScanResponseSchema,
  type VisionScanRequest,
} from "@leadshelf/api-contracts/vision/v1"
import {
  createConfiguredVisionProvider,
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_OPENAI_VISION_MODEL,
  GeminiVisionProvider,
  GEMINI_PROVIDER,
  OpenAiVisionProvider,
  OPENAI_PROVIDER,
  ReferenceSlotStubProvider,
  STUB_MODEL_VERSION,
  STUB_PROVIDER,
  type VisionFetch,
  type VisionImageFetch,
} from "./provider"

const request: VisionScanRequest = {
  protocolVersion: VISION_PROTOCOL_VERSION,
  organizationId: "org-a",
  planogramVersionId: "version-a",
  photoSubmissionId: "photo-a",
  photoUrl: "photos/org-a/task-a/photo-a.jpg",
  goldenReferenceId: "reference-a",
  goldenReferenceUrl: "photos/org-a/reference-a.jpg",
  slots: [
    {
      id: "slot-a",
      placementId: "placement-a",
      productId: "product-a",
      productSku: "SKU-A",
      label: "Product A",
      xPct: 10,
      yPct: 20,
      widthPct: 30,
      heightPct: 40,
    },
  ],
}

describe("ReferenceSlotStubProvider", () => {
  it("returns schema-valid low-confidence detections and compliance findings", async () => {
    const response = await new ReferenceSlotStubProvider().scan(request)

    expect(visionScanResponseSchema.parse(response)).toEqual(response)
    expect(response.protocolVersion).toBe(VISION_PROTOCOL_VERSION)
    expect(response.provider).toBe(STUB_PROVIDER)
    expect(response.modelVersion).toBe(STUB_MODEL_VERSION)
    expect(response.status).toBe("needs_human_review")
    expect(response.detections).toEqual([
      {
        slotId: "slot-a",
        productId: "product-a",
        productSku: "SKU-A",
        label: "Product A",
        confidence: 0.35,
        bbox: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 },
      },
    ])
    expect(response.compliance).toEqual({
      score: 0,
      status: "FAIL",
      totalSlots: 1,
      matchedSlots: 0,
      missingSlots: 1,
      wrongProducts: 0,
      extraDetections: 0,
    })
    expect(response.findings.missing).toEqual([
      { slotId: "slot-a", expectedProductId: "product-a", expectedProductSku: "SKU-A" },
    ])
    expect(response.warnings).toContain("stub_provider_uses_reference_slots_without_image_inference")
  })

  it("fails explicitly when no reference slots are provided", async () => {
    const response = await new ReferenceSlotStubProvider().scan({ ...request, slots: [] })

    expect(response.status).toBe("failed")
    expect(response.compliance.totalSlots).toBe(0)
    expect(response.warnings).toContain("no_reference_slots_provided")
  })
})

describe("OpenAiVisionProvider", () => {
  it("builds a Responses API vision request and maps structured detections into compliance", async () => {
    let body: Record<string, unknown> | null = null
    const fetchImpl: VisionFetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/responses")
      expect(init.headers.Authorization).toBe("Bearer test-key")
      body = JSON.parse(init.body) as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output_text: JSON.stringify({
              detections: [
                {
                  slotId: "slot-a",
                  productId: "product-a",
                  productSku: "SKU-A",
                  label: "Product A",
                  confidence: 0.92,
                  bbox: { xPct: 11, yPct: 21, widthPct: 29, heightPct: 39 },
                },
              ],
              warnings: ["low_light"],
            }),
          })
        },
      }
    }

    const response = await new OpenAiVisionProvider({
      apiKey: "test-key",
      fetchImpl,
    }).scan({ ...request, photoUrl: "https://cdn.example/photo.jpg", goldenReferenceUrl: "https://cdn.example/ref.jpg" })

    expect(body).toMatchObject({
      model: DEFAULT_OPENAI_VISION_MODEL,
      text: {
        format: {
          type: "json_schema",
          name: "leadshelf_shelf_scan",
          strict: true,
        },
      },
    })
    expect(body).not.toBeNull()
    const requestBody = body as unknown as Record<string, unknown>
    const input = requestBody.input as Array<{ content: Array<{ type: string; image_url?: string; text?: string }> }>
    expect(input[0]?.content.some((part) => part.type === "input_image" && part.image_url === "https://cdn.example/photo.jpg")).toBe(true)
    expect(input[0]?.content.some((part) => part.type === "input_image" && part.image_url === "https://cdn.example/ref.jpg")).toBe(true)

    expect(visionScanResponseSchema.parse(response)).toEqual(response)
    expect(response.provider).toBe(OPENAI_PROVIDER)
    expect(response.modelVersion).toBe(DEFAULT_OPENAI_VISION_MODEL)
    expect(response.status).toBe("completed")
    expect(response.compliance).toMatchObject({ score: 0.92, status: "PASS", matchedSlots: 1 })
    expect(response.warnings).toContain("low_light")
  })

  it("fails explicitly when the photo URL is not resolvable for OpenAI", async () => {
    const response = await new OpenAiVisionProvider({
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error("fetch_should_not_be_called")
      },
    }).scan(request)

    expect(response.status).toBe("failed")
    expect(response.detections).toEqual([])
    expect(response.warnings).toContain("openai_photo_url_not_resolvable")
  })

  it("can resolve relative media paths through VISION_PUBLIC_BASE_URL", async () => {
    const fetchImpl: VisionFetch = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        input: Array<{ content: Array<{ type: string; image_url?: string }> }>
      }
      expect(body.input[0]?.content).toContainEqual({
        type: "input_image",
        image_url: "https://media.example/photos/org-a/task-a/photo-a.jpg",
      })
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ detections: [], warnings: [] }),
                  },
                ],
              },
            ],
          })
        },
      }
    }

    const response = await new OpenAiVisionProvider({
      apiKey: "test-key",
      publicBaseUrl: "https://media.example/",
      fetchImpl,
    }).scan(request)

    expect(response.status).toBe("needs_human_review")
    expect(response.compliance.missingSlots).toBe(1)
  })

  it("selects the stub provider by default and OpenAI only when configured", () => {
    expect(createConfiguredVisionProvider({}).metadata).toEqual({
      provider: STUB_PROVIDER,
      modelVersion: STUB_MODEL_VERSION,
    })
    expect(
      createConfiguredVisionProvider({
        VISION_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_VISION_MODEL: "gpt-test",
      }).metadata,
    ).toEqual({ provider: OPENAI_PROVIDER, modelVersion: "gpt-test" })
  })
})

describe("GeminiVisionProvider", () => {
  it("inlines the shelf photo as base64 and maps structured detections into compliance", async () => {
    let calledUrl: string | null = null
    let body: Record<string, unknown> | null = null
    const imageFetchImpl: VisionImageFetch = async () => ({
      ok: true,
      status: 200,
      async arrayBuffer() {
        return new TextEncoder().encode("fake-jpeg-bytes").buffer
      },
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null) },
    })
    const fetchImpl: VisionFetch = async (url, init) => {
      calledUrl = url
      expect(init.headers["x-goog-api-key"]).toBe("gemini-key")
      body = JSON.parse(init.body) as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        detections: [
                          {
                            slotId: "slot-a",
                            productId: "product-a",
                            productSku: "SKU-A",
                            label: "Product A",
                            confidence: 0.9,
                            bbox: { xPct: 12, yPct: 22, widthPct: 28, heightPct: 38 },
                          },
                        ],
                        warnings: ["depth_not_confirmed"],
                      }),
                    },
                  ],
                },
              },
            ],
          })
        },
      }
    }

    const response = await new GeminiVisionProvider({ apiKey: "gemini-key", fetchImpl, imageFetchImpl }).scan({
      ...request,
      photoUrl: "https://cdn.example/photo.jpg",
      goldenReferenceUrl: undefined,
    })

    expect(calledUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    )
    expect(body).not.toBeNull()
    const parts = (body as unknown as { contents: Array<{ parts: Array<Record<string, unknown>> }> })
      .contents[0]!.parts
    expect(parts.some((p) => "inline_data" in p)).toBe(true)
    expect(visionScanResponseSchema.parse(response)).toEqual(response)
    expect(response.provider).toBe(GEMINI_PROVIDER)
    expect(response.modelVersion).toBe(DEFAULT_GEMINI_VISION_MODEL)
    expect(response.status).toBe("completed")
    expect(response.compliance).toMatchObject({ score: 0.9, status: "PASS", matchedSlots: 1 })
    expect(response.warnings).toContain("depth_not_confirmed")
  })

  it("fails explicitly when there are no reference slots", async () => {
    const response = await new GeminiVisionProvider({
      apiKey: "gemini-key",
      fetchImpl: async () => {
        throw new Error("fetch_should_not_be_called")
      },
    }).scan({ ...request, slots: [] })
    expect(response.status).toBe("failed")
    expect(response.warnings).toContain("no_reference_slots_provided")
  })

  it("is selected by the factory when VISION_PROVIDER=gemini", () => {
    expect(
      createConfiguredVisionProvider({
        VISION_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_VISION_MODEL: "gemini-2.5-pro",
      }).metadata,
    ).toEqual({ provider: GEMINI_PROVIDER, modelVersion: "gemini-2.5-pro" })
  })
})
