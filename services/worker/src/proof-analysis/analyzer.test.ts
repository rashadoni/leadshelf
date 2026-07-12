import { afterEach, describe, expect, test, vi } from "vitest"
import { VISION_PROTOCOL_VERSION, type VisionScanRequest } from "@leadshelf/api-contracts/vision/v1"
import { analyzeSelectedProofFrames, configuredProofAnalysisIdentity } from "./analyzer"
import type { ExtractedProofFrame } from "./frame-extractor"

const request: VisionScanRequest = {
  protocolVersion: VISION_PROTOCOL_VERSION,
  organizationId: "org-a",
  planogramVersionId: "version-a",
  photoSubmissionId: "photo-a",
  photoUrl: "videos/org-a/task-a/photo-a.mp4",
  goldenReferenceId: undefined,
  goldenReferenceUrl: undefined,
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

const frames: ExtractedProofFrame[] = [
  { timestampMs: 900, buffer: Buffer.from("fake-jpeg"), contentType: "image/jpeg" },
]

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.LEADSHELF_PROOF_AI_PROVIDER
  delete process.env.VISION_PROVIDER
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_VISION_MODEL
  delete process.env.OPENAI_VISION_MODEL
})

describe("analyzeSelectedProofFrames gemini path", () => {
  test("fixes provider and model identity before inference", () => {
    process.env.LEADSHELF_PROOF_AI_PROVIDER = "openai"
    process.env.OPENAI_VISION_MODEL = "vision-test-v2"
    expect(configuredProofAnalysisIdentity()).toEqual({
      provider: "openai",
      modelVersion: "vision-test-v2",
    })
  })

  test("inlines frames as base64 and maps Gemini JSON into compliance + findings", async () => {
    process.env.LEADSHELF_PROOF_AI_PROVIDER = "gemini"
    process.env.GEMINI_API_KEY = "gemini-key"
    let calledUrl: string | null = null
    let headers: Record<string, string> | null = null
    let body: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calledUrl = url
      headers = init.headers
      body = JSON.parse(init.body) as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 87 },
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        status: "REVIEW",
                        summary: "Front row ok, depth not visible.",
                        depthConfirmed: false,
                        detections: [
                          {
                            slotId: "slot-a",
                            productSku: "SKU-A",
                            label: "Product A",
                            confidence: 0.88,
                            bbox: { xPct: 11, yPct: 21, widthPct: 29, heightPct: 39 },
                          },
                        ],
                        findings: [
                          {
                            type: "depth_not_confirmed",
                            severity: "warning",
                            slotId: "slot-a",
                            productSku: "SKU-A",
                            evidenceFrameTimestampMs: 900,
                            note: "Back row not visible in the selected frames.",
                          },
                        ],
                        warnings: [],
                      }),
                    },
                  ],
                },
              },
            ],
          }
        },
      }
    })

    const result = await analyzeSelectedProofFrames(request, frames)

    expect(calledUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    )
    expect(headers!["x-goog-api-key"]).toBe("gemini-key")
    const parts = (body as unknown as { contents: Array<{ parts: Array<Record<string, unknown>> }> }).contents[0]!
      .parts
    expect(parts.some((p) => "inline_data" in p)).toBe(true)
    expect(result.response.provider).toBe("gemini")
    expect(result.response.modelVersion).toBe("gemini-2.5-flash")
    expect(result.aiFindings.some((f) => f.type === "depth_not_confirmed")).toBe(true)
    expect(result.telemetry).toEqual({ inputTokens: 321, outputTokens: 87, costMicros: null })
    // depthConfirmed=false добавляет предупреждение
    expect(result.response.warnings).toContain("depth_not_confirmed_by_selected_frames")
  })

  test("throws a clear error when the Gemini key is missing", async () => {
    process.env.LEADSHELF_PROOF_AI_PROVIDER = "gemini"
    await expect(analyzeSelectedProofFrames(request, frames)).rejects.toThrow("gemini_api_key_missing")
  })
})
