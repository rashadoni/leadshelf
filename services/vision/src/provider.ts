import {
  VISION_PROTOCOL_VERSION,
  type VisionDetection,
  type VisionScanRequest,
  type VisionScanResponse,
} from "@leadshelf/api-contracts/vision/v1"
import { calculateShelfCompliance } from "@leadshelf/core"
import { z } from "zod"

export const STUB_PROVIDER = "leadshelf-stub"
export const STUB_MODEL_VERSION = "stub-reference-slots-v1"
export const OPENAI_PROVIDER = "openai-responses"
export const DEFAULT_OPENAI_VISION_MODEL = "gpt-5.5"

export interface VisionProvider {
  readonly metadata: {
    provider: string
    modelVersion: string
  }
  scan(request: VisionScanRequest): Promise<VisionScanResponse>
}

export class ReferenceSlotStubProvider implements VisionProvider {
  readonly metadata = {
    provider: STUB_PROVIDER,
    modelVersion: STUB_MODEL_VERSION,
  }

  async scan(request: VisionScanRequest): Promise<VisionScanResponse> {
    const detections: VisionDetection[] = request.slots.map((slot) => ({
      slotId: slot.id,
      productId: slot.productId,
      productSku: slot.productSku,
      label: slot.label,
      confidence: 0.35,
      bbox: {
        xPct: slot.xPct,
        yPct: slot.yPct,
        widthPct: slot.widthPct,
        heightPct: slot.heightPct,
      },
    }))
    const complianceResult = calculateShelfCompliance({
      slots: request.slots.map((slot) => ({
        id: slot.id,
        productId: slot.productId,
        productSku: slot.productSku,
      })),
      detections,
    })

    return {
      protocolVersion: VISION_PROTOCOL_VERSION,
      provider: STUB_PROVIDER,
      modelVersion: STUB_MODEL_VERSION,
      status: request.slots.length > 0 ? "needs_human_review" : "failed",
      detections,
      embedding: null,
      compliance: {
        score: complianceResult.score,
        status: complianceResult.status,
        totalSlots: complianceResult.totalSlots,
        matchedSlots: complianceResult.matchedSlots,
        missingSlots: complianceResult.missingSlots,
        wrongProducts: complianceResult.wrongProducts,
        extraDetections: complianceResult.extraDetections,
      },
      findings: complianceResult.findings,
      warnings: [
        request.slots.length > 0
          ? "stub_provider_uses_reference_slots_without_image_inference"
          : "no_reference_slots_provided",
      ],
    }
  }
}

type FetchResponse = {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type VisionFetch = (
  input: string,
  init: {
    method: "POST"
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  },
) => Promise<FetchResponse>

export type OpenAiVisionProviderConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
  publicBaseUrl?: string
  timeoutMs?: number
  minConfidence?: number
  fetchImpl?: VisionFetch
}

const openAiDetectionOutputSchema = z.object({
  slotId: z.string(),
  productId: z.string(),
  productSku: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: z.object({
    xPct: z.number(),
    yPct: z.number(),
    widthPct: z.number(),
    heightPct: z.number(),
  }),
})

const openAiScanOutputSchema = z.object({
  detections: z.array(openAiDetectionOutputSchema).max(2000),
  warnings: z.array(z.string()).default([]),
})

const openAiResponseFormatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["detections", "warnings"],
  properties: {
    detections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slotId", "productId", "productSku", "label", "confidence", "bbox"],
        properties: {
          slotId: { type: "string", description: "Known reference slot id, or empty string for an extra detection." },
          productId: { type: "string", description: "Expected product id only when recognized, otherwise empty string." },
          productSku: { type: "string", description: "Expected product SKU only when recognized, otherwise empty string." },
          label: { type: "string", description: "Visible or expected product label, or empty string if unknown." },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          bbox: {
            type: "object",
            additionalProperties: false,
            required: ["xPct", "yPct", "widthPct", "heightPct"],
            properties: {
              xPct: { type: "number", minimum: 0, maximum: 100 },
              yPct: { type: "number", minimum: 0, maximum: 100 },
              widthPct: { type: "number", minimum: 0.1, maximum: 100 },
              heightPct: { type: "number", minimum: 0.1, maximum: 100 },
            },
          },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampPct(value: number, min: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(100, Number(value.toFixed(2))))
}

function resolveImageUrl(value: string, publicBaseUrl?: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) return trimmed
  if (!publicBaseUrl?.trim()) return null
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`
  return new URL(trimmed.replace(/^\/+/, ""), base).toString()
}

function buildPrompt(request: VisionScanRequest): string {
  const slots = request.slots.map((slot) => ({
    slotId: slot.id,
    placementId: slot.placementId,
    productId: slot.productId,
    productSku: slot.productSku,
    label: slot.label,
    expectedBoxPct: {
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    },
  }))

  return [
    "You are the LeadShelf shelf compliance detector.",
    "Compare the target shelf photo against the reference slots and the optional golden reference photo.",
    "Return only products that are visible in the target shelf photo.",
    "Use known slotId values only from referenceSlots. Use an empty slotId for extra visible products.",
    "Use the expected productId/productSku only when that product is visibly recognized. Otherwise use empty strings.",
    "Bounding boxes must be percentages of the target photo, not the golden reference image.",
    "If recognition is uncertain, keep confidence below 0.5 or omit the detection.",
    `referenceSlots=${JSON.stringify(slots)}`,
  ].join("\n")
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("openai_response_not_json")
  }
}

function extractOpenAiOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("openai_response_not_object")
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === "string") return record.output_text
  const output = record.output
  if (!Array.isArray(output)) throw new Error("openai_response_missing_output")

  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === "string") return text
    }
  }
  throw new Error("openai_response_missing_output_text")
}

function failedOpenAiResponse(request: VisionScanRequest, modelVersion: string, warnings: string[]): VisionScanResponse {
  const complianceResult = calculateShelfCompliance({
    slots: request.slots.map((slot) => ({
      id: slot.id,
      productId: slot.productId,
      productSku: slot.productSku,
    })),
    detections: [],
  })

  return {
    protocolVersion: VISION_PROTOCOL_VERSION,
    provider: OPENAI_PROVIDER,
    modelVersion,
    status: "failed",
    detections: [],
    embedding: null,
    compliance: {
      score: complianceResult.score,
      status: complianceResult.status,
      totalSlots: complianceResult.totalSlots,
      matchedSlots: complianceResult.matchedSlots,
      missingSlots: complianceResult.missingSlots,
      wrongProducts: complianceResult.wrongProducts,
      extraDetections: complianceResult.extraDetections,
    },
    findings: complianceResult.findings,
    warnings,
  }
}

export class OpenAiVisionProvider implements VisionProvider {
  readonly metadata: { provider: string; modelVersion: string }

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly publicBaseUrl?: string
  private readonly timeoutMs: number
  private readonly minConfidence: number
  private readonly fetchImpl: VisionFetch

  constructor(config: OpenAiVisionProviderConfig) {
    const apiKey = config.apiKey.trim()
    if (!apiKey) throw new Error("OPENAI_API_KEY is required when VISION_PROVIDER=openai")
    const model = config.model?.trim() || DEFAULT_OPENAI_VISION_MODEL
    this.metadata = { provider: OPENAI_PROVIDER, modelVersion: model }
    this.apiKey = apiKey
    this.baseUrl = (config.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
    this.publicBaseUrl = config.publicBaseUrl?.trim()
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.minConfidence = config.minConfidence ?? 0.5
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async scan(request: VisionScanRequest): Promise<VisionScanResponse> {
    if (request.slots.length === 0) {
      return failedOpenAiResponse(request, this.metadata.modelVersion, ["no_reference_slots_provided"])
    }

    const photoUrl = resolveImageUrl(request.photoUrl, this.publicBaseUrl)
    if (!photoUrl) {
      return failedOpenAiResponse(request, this.metadata.modelVersion, [
        "openai_photo_url_not_resolvable",
        "provide_https_or_data_url_or_configure_vision_public_base_url",
      ])
    }
    const goldenReferenceUrl = request.goldenReferenceUrl
      ? resolveImageUrl(request.goldenReferenceUrl, this.publicBaseUrl)
      : null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [
        { type: "input_text", text: buildPrompt(request) },
        { type: "input_text", text: "Target shelf photo:" },
        { type: "input_image", image_url: photoUrl },
      ]
      if (goldenReferenceUrl) {
        content.push({ type: "input_text", text: "Golden reference photo:" })
        content.push({ type: "input_image", image_url: goldenReferenceUrl })
      }

      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.metadata.modelVersion,
          input: [{ role: "user", content }],
          max_output_tokens: 4000,
          text: {
            format: {
              type: "json_schema",
              name: "leadshelf_shelf_scan",
              strict: true,
              schema: openAiResponseFormatSchema,
            },
          },
        }),
      })
      const responseText = await response.text()
      if (!response.ok) {
        throw new Error(`openai_vision_request_failed:${response.status}:${responseText.slice(0, 240)}`)
      }

      const outputText = extractOpenAiOutputText(parseJsonObject(responseText))
      const output = openAiScanOutputSchema.parse(parseJsonObject(outputText))
      const detections: VisionDetection[] = output.detections.map((detection) => ({
        slotId: emptyToNull(detection.slotId),
        productId: emptyToNull(detection.productId),
        productSku: emptyToNull(detection.productSku),
        label: emptyToNull(detection.label),
        confidence: detection.confidence,
        bbox: {
          xPct: clampPct(detection.bbox.xPct, 0),
          yPct: clampPct(detection.bbox.yPct, 0),
          widthPct: clampPct(detection.bbox.widthPct, 0.1),
          heightPct: clampPct(detection.bbox.heightPct, 0.1),
        },
      }))

      const complianceResult = calculateShelfCompliance({
        slots: request.slots.map((slot) => ({
          id: slot.id,
          productId: slot.productId,
          productSku: slot.productSku,
        })),
        detections,
        minConfidence: this.minConfidence,
      })
      const warnings = [...output.warnings]
      if (request.goldenReferenceUrl && !goldenReferenceUrl) warnings.push("golden_reference_url_not_resolvable")

      return {
        protocolVersion: VISION_PROTOCOL_VERSION,
        provider: OPENAI_PROVIDER,
        modelVersion: this.metadata.modelVersion,
        status: complianceResult.status === "PASS" ? "completed" : "needs_human_review",
        detections,
        embedding: null,
        compliance: {
          score: complianceResult.score,
          status: complianceResult.status,
          totalSlots: complianceResult.totalSlots,
          matchedSlots: complianceResult.matchedSlots,
          missingSlots: complianceResult.missingSlots,
          wrongProducts: complianceResult.wrongProducts,
          extraDetections: complianceResult.extraDetections,
        },
        findings: complianceResult.findings,
        warnings,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("openai_vision_request_timeout")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createConfiguredVisionProvider(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { fetchImpl?: VisionFetch } = {},
): VisionProvider {
  const provider = env.VISION_PROVIDER?.trim().toLowerCase() || "stub"
  if (provider === "stub") return new ReferenceSlotStubProvider()
  if (provider === "openai") {
    return new OpenAiVisionProvider({
      apiKey: env.OPENAI_API_KEY ?? "",
      model: env.OPENAI_VISION_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
      publicBaseUrl: env.VISION_PUBLIC_BASE_URL,
      timeoutMs: env.OPENAI_VISION_TIMEOUT_MS ? Number.parseInt(env.OPENAI_VISION_TIMEOUT_MS, 10) : undefined,
      minConfidence: env.OPENAI_VISION_MIN_CONFIDENCE ? Number.parseFloat(env.OPENAI_VISION_MIN_CONFIDENCE) : undefined,
      fetchImpl: overrides.fetchImpl,
    })
  }
  throw new Error(`Unsupported VISION_PROVIDER: ${provider}`)
}
