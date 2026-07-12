import { describe, expect, it } from "vitest"
import {
  VISION_PROTOCOL_VERSION,
  visionScanResponseSchema,
  type VisionScanRequest,
} from "@leadshelf/api-contracts/vision/v1"
import {
  createConfiguredSkuRecognizer,
  createConfiguredVisionProvider,
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_OPENAI_VISION_MODEL,
  GeminiSkuRecognizer,
  GeminiVisionProvider,
  GEMINI_PROVIDER,
  OpenAiSkuRecognizer,
  OpenAiVisionProvider,
  OPENAI_PROVIDER,
  ReferenceSlotStubProvider,
  STUB_MODEL_VERSION,
  STUB_PROVIDER,
  StubShelfSkuRecognizer,
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
                      text: `\`\`\`json\n${JSON.stringify({
                        detections: [
                          {
                            slotId: "slot-a",
                            productId: "product-a",
                            productSku: "SKU-A",
                            label: "Product A",
                            confidence: 0.9,
                            bbox: { xPct: 0.1, yPct: 0.2, widthPct: 0.3, heightPct: 0.4 },
                          },
                        ],
                        warnings: ["depth_not_confirmed"],
                      })}\n\`\`\``,
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
    expect(response.detections[0]?.bbox).toEqual({ xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 })
    expect(response.warnings).toContain("depth_not_confirmed")
    expect(response.warnings).toContain("bbox_unit_interval_normalized")
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

describe("SKU recognizers (two-stage second stage)", () => {
  const boxes = [
    { id: "box-1", bbox: { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 } },
    { id: "box-2", bbox: { xPct: 30, yPct: 0, widthPct: 20, heightPct: 20 } },
    { id: "box-3", bbox: { xPct: 60, yPct: 0, widthPct: 20, heightPct: 20 } },
  ]
  const catalog = ["SKU-A", "SKU-B"]
  const dataUrlPhoto = `data:image/jpeg;base64,${Buffer.from("fake").toString("base64")}`

  it("stub возвращает только «не уверен» и не может нарисовать accuracy", async () => {
    const result = await new StubShelfSkuRecognizer().recognizeDetailed("private://x", boxes, catalog)
    expect(result.assignments).toEqual(boxes.map((box) => ({ id: box.id, productSku: null, confidence: 0 })))
    expect(result.warnings).toContain("stub_sku_recognizer_returns_uncertain_only")
  })

  it("gemini: numbered-boxes промпт, маппинг ответов, анти-галлюцинация и недостающие боксы", async () => {
    let promptText = ""
    const fetchImpl: VisionFetch = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        contents: Array<{ parts: Array<{ text?: string }> }>
      }
      promptText = body.contents[0]!.parts[0]!.text ?? ""
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
                        assignments: [
                          { boxId: "box-1", productSku: "SKU-A", confidence: 0.9 },
                          { boxId: "box-2", productSku: "SKU-HALLUCINATED", confidence: 0.8 },
                          // box-3 отсутствует в ответе
                          { boxId: "box-unknown", productSku: "SKU-B", confidence: 0.7 },
                        ],
                        warnings: ["label_partially_occluded"],
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

    const result = await new GeminiSkuRecognizer({ apiKey: "gemini-key", fetchImpl }).recognizeDetailed(
      dataUrlPhoto,
      boxes,
      catalog,
    )

    // Промпт содержит кандидатов и нумерованные боксы — контекст для аудита.
    expect(promptText).toContain("candidateSkus")
    expect(promptText).toContain("SKU-A")
    expect(promptText).toContain("box-1")
    expect(result.assignments).toEqual([
      { id: "box-1", productSku: "SKU-A", confidence: 0.9 },
      { id: "box-2", productSku: null, confidence: 0 }, // вне candidate-списка
      { id: "box-3", productSku: null, confidence: 0 }, // не пришёл в ответе
    ])
    expect(result.warnings).toContain("label_partially_occluded")
    expect(result.warnings).toContain("sku_not_in_candidates:box-2:SKU-HALLUCINATED")
    expect(result.warnings).toContain("box_missing_from_response:box-3")
    expect(result.warnings).toContain("unknown_box_in_response:box-unknown")
  })

  it("gemini: пустой productSku означает «не уверен» (null)", async () => {
    const fetchImpl: VisionFetch = async () => ({
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
                      assignments: boxes.map((box) => ({ boxId: box.id, productSku: "", confidence: 0.1 })),
                      warnings: [],
                    }),
                  },
                ],
              },
            },
          ],
        })
      },
    })
    const result = await new GeminiSkuRecognizer({ apiKey: "gemini-key", fetchImpl }).recognizeDetailed(
      dataUrlPhoto,
      boxes,
      catalog,
    )
    expect(result.assignments.every((row) => row.productSku === null)).toBe(true)
  })

  it("openai: строгая json_schema и маппинг через output_text", async () => {
    let requestBody: Record<string, unknown> | null = null
    const fetchImpl: VisionFetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/responses")
      requestBody = JSON.parse(init.body) as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            output_text: JSON.stringify({
              assignments: [
                { boxId: "box-1", productSku: "SKU-B", confidence: 0.85 },
                { boxId: "box-2", productSku: "", confidence: 0.2 },
                { boxId: "box-3", productSku: "SKU-A", confidence: 0.75 },
              ],
              warnings: [],
            }),
          })
        },
      }
    }
    const result = await new OpenAiSkuRecognizer({ apiKey: "openai-key", fetchImpl }).recognizeDetailed(
      dataUrlPhoto,
      boxes,
      catalog,
    )
    const format = (requestBody as unknown as {
      text: { format: { type: string; name: string; strict: boolean } }
    }).text.format
    expect(format).toMatchObject({ type: "json_schema", name: "leadshelf_sku_recognition", strict: true })
    expect(result.assignments).toEqual([
      { id: "box-1", productSku: "SKU-B", confidence: 0.85 },
      { id: "box-2", productSku: null, confidence: 0.2 },
      { id: "box-3", productSku: "SKU-A", confidence: 0.75 },
    ])
  })

  it("фабрика выбирает recognizer по VISION_PROVIDER", () => {
    expect(createConfiguredSkuRecognizer({ VISION_PROVIDER: "stub" }).provider).toBe(STUB_PROVIDER)
    expect(
      createConfiguredSkuRecognizer({ VISION_PROVIDER: "gemini", GEMINI_API_KEY: "k" }).provider,
    ).toBe(GEMINI_PROVIDER)
    expect(
      createConfiguredSkuRecognizer({ VISION_PROVIDER: "openai", OPENAI_API_KEY: "k" }).provider,
    ).toBe(OPENAI_PROVIDER)
    expect(() => createConfiguredSkuRecognizer({ VISION_PROVIDER: "nope" })).toThrow(
      "Unsupported VISION_PROVIDER",
    )
  })
})
