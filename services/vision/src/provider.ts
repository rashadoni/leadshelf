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
export const DEFAULT_OPENAI_VISION_MODEL = "gpt-5.4"
export const GEMINI_PROVIDER = "google-gemini"
export const DEFAULT_GEMINI_VISION_MODEL = "gemini-2.5-flash"

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
    "Coordinates MUST use 0..100 percentage units: xPct=25 means one quarter of the image, never 0.25.",
    "If recognition is uncertain, keep confidence below 0.5 or omit the detection.",
    `referenceSlots=${JSON.stringify(slots)}`,
  ].join("\n")
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const objectStart = trimmed.indexOf("{")
  const objectEnd = trimmed.lastIndexOf("}")
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1))
  }
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next safe extraction; zod still validates the parsed shape.
    }
  }
  throw new Error("vision_response_not_json")
}

type DetectionBBox = z.infer<typeof openAiDetectionOutputSchema>["bbox"]

function usesUnitInterval(bbox: DetectionBBox): boolean {
  return [bbox.xPct, bbox.yPct, bbox.widthPct, bbox.heightPct]
    .every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
}

function normalizeDetectionBBox(bbox: DetectionBBox) {
  const scale = usesUnitInterval(bbox) ? 100 : 1
  return {
    xPct: clampPct(bbox.xPct * scale, 0),
    yPct: clampPct(bbox.yPct * scale, 0),
    widthPct: clampPct(bbox.widthPct * scale, 0.1),
    heightPct: clampPct(bbox.heightPct * scale, 0.1),
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

function failedProviderResponse(
  request: VisionScanRequest,
  provider: string,
  modelVersion: string,
  warnings: string[],
): VisionScanResponse {
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
    provider,
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
      return failedProviderResponse(request, OPENAI_PROVIDER, this.metadata.modelVersion, [
        "no_reference_slots_provided",
      ])
    }

    const photoUrl = resolveImageUrl(request.photoUrl, this.publicBaseUrl)
    if (!photoUrl) {
      return failedProviderResponse(request, OPENAI_PROVIDER, this.metadata.modelVersion, [
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
      const normalizedUnitInterval = output.detections.some((detection) => usesUnitInterval(detection.bbox))
      const detections: VisionDetection[] = output.detections.map((detection) => ({
        slotId: emptyToNull(detection.slotId),
        productId: emptyToNull(detection.productId),
        productSku: emptyToNull(detection.productSku),
        label: emptyToNull(detection.label),
        confidence: detection.confidence,
        bbox: normalizeDetectionBBox(detection.bbox),
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
      if (normalizedUnitInterval) warnings.push("bbox_unit_interval_normalized")
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

// Gemini (Google Generative Language API). В отличие от OpenAI Responses,
// Gemini не тянет image URL сам — картинку надо инлайнить как base64
// (inline_data), поэтому провайдер сам качает байты по photoUrl. Строгую
// json_schema не используем: Gemini дает JSON через responseMimeType, а
// форму гарантирует zod-парсинг того же контракта.
export type VisionImageFetch = (
  url: string,
  init: { signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
  headers: { get(name: string): string | null }
}>

export type GeminiVisionProviderConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
  publicBaseUrl?: string
  timeoutMs?: number
  minConfidence?: number
  fetchImpl?: VisionFetch
  imageFetchImpl?: VisionImageFetch
}

const geminiOutputInstruction = [
  "Return ONLY a JSON object with this exact shape:",
  '{"detections":[{"slotId":string,"productId":string,"productSku":string,"label":string,',
  '"confidence":number,"bbox":{"xPct":number,"yPct":number,"widthPct":number,"heightPct":number}}],',
  '"warnings":[string]}',
  "Use empty strings for unknown slotId/productId/productSku/label. No markdown, no prose.",
].join(" ")

type InlineImage = { mimeType: string; data: string }

function inlineImageFromDataUrl(url: string): InlineImage | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(url)
  if (!match) return null
  return { mimeType: match[1]!, data: match[2]! }
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new Error("gemini_response_not_object")
  const candidates = (payload as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) throw new Error("gemini_response_missing_candidates")
  for (const candidate of candidates) {
    const content = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>).content : null
    const parts = content && typeof content === "object" ? (content as Record<string, unknown>).parts : null
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      const text = part && typeof part === "object" ? (part as Record<string, unknown>).text : null
      if (typeof text === "string") return text
    }
  }
  throw new Error("gemini_response_missing_text")
}

export class GeminiVisionProvider implements VisionProvider {
  readonly metadata: { provider: string; modelVersion: string }

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly publicBaseUrl?: string
  private readonly timeoutMs: number
  private readonly minConfidence: number
  private readonly fetchImpl: VisionFetch
  private readonly imageFetchImpl: VisionImageFetch

  constructor(config: GeminiVisionProviderConfig) {
    const apiKey = config.apiKey.trim()
    if (!apiKey) throw new Error("GEMINI_API_KEY is required when VISION_PROVIDER=gemini")
    const model = config.model?.trim() || DEFAULT_GEMINI_VISION_MODEL
    this.metadata = { provider: GEMINI_PROVIDER, modelVersion: model }
    this.apiKey = apiKey
    this.baseUrl = (config.baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")
    this.publicBaseUrl = config.publicBaseUrl?.trim()
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.minConfidence = config.minConfidence ?? 0.5
    this.fetchImpl = config.fetchImpl ?? fetch
    this.imageFetchImpl =
      config.imageFetchImpl ??
      ((url, init) => fetch(url, { method: "GET", signal: init.signal }) as ReturnType<VisionImageFetch>)
  }

  private async toInlineImage(url: string, signal: AbortSignal): Promise<InlineImage> {
    const fromData = inlineImageFromDataUrl(url)
    if (fromData) return fromData
    const res = await this.imageFetchImpl(url, { signal })
    if (!res.ok) throw new Error(`gemini_image_fetch_failed:${res.status}`)
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg"
    const data = Buffer.from(await res.arrayBuffer()).toString("base64")
    return { mimeType, data }
  }

  async scan(request: VisionScanRequest): Promise<VisionScanResponse> {
    if (request.slots.length === 0) {
      return failedProviderResponse(request, GEMINI_PROVIDER, this.metadata.modelVersion, [
        "no_reference_slots_provided",
      ])
    }
    const photoUrl = resolveImageUrl(request.photoUrl, this.publicBaseUrl)
    if (!photoUrl) {
      return failedProviderResponse(request, GEMINI_PROVIDER, this.metadata.modelVersion, [
        "gemini_photo_url_not_resolvable",
        "provide_https_or_data_url_or_configure_vision_public_base_url",
      ])
    }
    const goldenReferenceUrl = request.goldenReferenceUrl
      ? resolveImageUrl(request.goldenReferenceUrl, this.publicBaseUrl)
      : null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
        { text: `${buildPrompt(request)}\n${geminiOutputInstruction}` },
        { text: "Target shelf photo:" },
      ]
      const photoImage = await this.toInlineImage(photoUrl, controller.signal)
      parts.push({ inline_data: { mime_type: photoImage.mimeType, data: photoImage.data } })
      const warnings: string[] = []
      if (goldenReferenceUrl) {
        parts.push({ text: "Golden reference photo:" })
        const goldenImage = await this.toInlineImage(goldenReferenceUrl, controller.signal)
        parts.push({ inline_data: { mime_type: goldenImage.mimeType, data: goldenImage.data } })
      } else if (request.goldenReferenceUrl) {
        warnings.push("golden_reference_url_not_resolvable")
      }

      const response = await this.fetchImpl(
        `${this.baseUrl}/models/${encodeURIComponent(this.metadata.modelVersion)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
            },
          }),
        },
      )
      const responseText = await response.text()
      if (!response.ok) {
        throw new Error(`gemini_vision_request_failed:${response.status}:${responseText.slice(0, 240)}`)
      }

      const outputText = extractGeminiText(parseJsonObject(responseText))
      const output = openAiScanOutputSchema.parse(parseJsonObject(outputText))
      const normalizedUnitInterval = output.detections.some((detection) => usesUnitInterval(detection.bbox))
      const detections: VisionDetection[] = output.detections.map((detection) => ({
        slotId: emptyToNull(detection.slotId),
        productId: emptyToNull(detection.productId),
        productSku: emptyToNull(detection.productSku),
        label: emptyToNull(detection.label),
        confidence: detection.confidence,
        bbox: normalizeDetectionBBox(detection.bbox),
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

      return {
        protocolVersion: VISION_PROTOCOL_VERSION,
        provider: GEMINI_PROVIDER,
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
        warnings: [
          ...output.warnings,
          ...(normalizedUnitInterval ? ["bbox_unit_interval_normalized"] : []),
          ...warnings,
        ],
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("gemini_vision_request_timeout")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

// ---------------------------------------------------------------------------
// SKU recognizers — вторая стадия two-stage eval (docs/roadmap Фаза 8):
// классификация SKU по УЖЕ известным боксам, отдельно от object detection.
// В oracle_boxes режиме боксы приходят из human-аннотаций, поэтому метрика
// изолирует чистую classification accuracy. Кандидаты SKU передаются только
// из релевантной планограммы/golden (не весь каталог): дешевле и без
// галлюцинаций чужих SKU. Ответ вне candidate-списка принудительно
// становится null + warning. AI остаётся review-only.
// ---------------------------------------------------------------------------

export const STUB_SKU_RECOGNIZER_MODEL_VERSION = "stub-sku-recognizer-v1"

export interface SkuRecognizerBoxInput {
  id: string
  bbox: { xPct: number; yPct: number; widthPct: number; heightPct: number }
}

export interface SkuRecognizerAssignment {
  id: string
  productSku: string | null
  confidence: number
}

export interface SkuRecognitionDetailedResult {
  assignments: SkuRecognizerAssignment[]
  warnings: string[]
}

export interface ShelfSkuRecognizerWithWarnings {
  readonly provider: string
  readonly modelVersion: string
  recognize(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognizerAssignment[]>
  recognizeDetailed(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognitionDetailedResult>
}

/**
 * Wiring-only заглушка: каждая коробка — «не уверен» (null, confidence 0).
 * Не может нарисовать фальшивую accuracy и, как и stub-провайдер,
 * не участвует в калибровке порогов и accuracy-claims.
 */
export class StubShelfSkuRecognizer implements ShelfSkuRecognizerWithWarnings {
  readonly provider = STUB_PROVIDER
  readonly modelVersion = STUB_SKU_RECOGNIZER_MODEL_VERSION

  async recognizeDetailed(
    _photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    _catalogSkus: string[],
  ): Promise<SkuRecognitionDetailedResult> {
    return {
      assignments: boxes.map((box) => ({ id: box.id, productSku: null, confidence: 0 })),
      warnings: ["stub_sku_recognizer_returns_uncertain_only"],
    }
  }

  async recognize(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognizerAssignment[]> {
    return (await this.recognizeDetailed(photoRef, boxes, catalogSkus)).assignments
  }
}

const skuRecognitionOutputSchema = z.object({
  assignments: z.array(
    z.object({
      boxId: z.string(),
      productSku: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  warnings: z.array(z.string()).default([]),
})

const skuRecognitionResponseFormatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assignments", "warnings"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["boxId", "productSku", "confidence"],
        properties: {
          boxId: { type: "string" },
          productSku: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const

function buildSkuRecognitionPrompt(
  boxes: SkuRecognizerBoxInput[],
  catalogSkus: string[],
): string {
  const numberedBoxes = boxes.map((box, index) => ({
    boxId: box.id,
    number: index + 1,
    boxPct: box.bbox,
  }))
  return [
    "You are the LeadShelf SKU classifier.",
    "The shelf photo contains the numbered product boxes listed below (percent coordinates, 0..100, origin top-left).",
    "For EVERY box pick the productSku ONLY from candidateSkus, or an empty string when uncertain.",
    "Never invent SKUs that are not in candidateSkus. Do not add or drop boxes: return one assignment per boxId.",
    "If the label is unreadable, rotated or occluded, use an empty productSku and low confidence.",
    `candidateSkus=${JSON.stringify(catalogSkus)}`,
    `boxes=${JSON.stringify(numberedBoxes)}`,
  ].join("\n")
}

const skuRecognitionOutputInstruction = [
  "Return ONLY a JSON object with this exact shape:",
  '{"assignments":[{"boxId":string,"productSku":string,"confidence":number}],"warnings":[string]}',
  "Use an empty productSku string when uncertain. No markdown, no prose.",
].join(" ")

function mapSkuAssignments(
  boxes: SkuRecognizerBoxInput[],
  catalogSkus: string[],
  output: z.infer<typeof skuRecognitionOutputSchema>,
): SkuRecognitionDetailedResult {
  const candidates = new Set(catalogSkus)
  const byBoxId = new Map(output.assignments.map((row) => [row.boxId, row]))
  const warnings = [...output.warnings]
  const knownBoxIds = new Set(boxes.map((box) => box.id))
  for (const row of output.assignments) {
    if (!knownBoxIds.has(row.boxId)) warnings.push(`unknown_box_in_response:${row.boxId}`)
  }
  const assignments = boxes.map((box) => {
    const row = byBoxId.get(box.id)
    if (!row) {
      warnings.push(`box_missing_from_response:${box.id}`)
      return { id: box.id, productSku: null, confidence: 0 }
    }
    const sku = emptyToNull(row.productSku)
    if (sku != null && !candidates.has(sku)) {
      warnings.push(`sku_not_in_candidates:${box.id}:${sku}`)
      return { id: box.id, productSku: null, confidence: 0 }
    }
    return { id: box.id, productSku: sku, confidence: row.confidence }
  })
  return { assignments, warnings }
}

export type GeminiSkuRecognizerConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
  publicBaseUrl?: string
  timeoutMs?: number
  fetchImpl?: VisionFetch
  imageFetchImpl?: VisionImageFetch
}

export class GeminiSkuRecognizer implements ShelfSkuRecognizerWithWarnings {
  readonly provider = GEMINI_PROVIDER
  readonly modelVersion: string

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly publicBaseUrl?: string
  private readonly timeoutMs: number
  private readonly fetchImpl: VisionFetch
  private readonly imageFetchImpl: VisionImageFetch

  constructor(config: GeminiSkuRecognizerConfig) {
    const apiKey = config.apiKey.trim()
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for the gemini sku recognizer")
    this.modelVersion = config.model?.trim() || DEFAULT_GEMINI_VISION_MODEL
    this.apiKey = apiKey
    this.baseUrl = (config.baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")
    this.publicBaseUrl = config.publicBaseUrl?.trim()
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.fetchImpl = config.fetchImpl ?? fetch
    this.imageFetchImpl =
      config.imageFetchImpl ??
      ((url, init) => fetch(url, { method: "GET", signal: init.signal }) as ReturnType<VisionImageFetch>)
  }

  private async toInlineImage(url: string, signal: AbortSignal): Promise<InlineImage> {
    const fromData = inlineImageFromDataUrl(url)
    if (fromData) return fromData
    const res = await this.imageFetchImpl(url, { signal })
    if (!res.ok) throw new Error(`gemini_image_fetch_failed:${res.status}`)
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg"
    const data = Buffer.from(await res.arrayBuffer()).toString("base64")
    return { mimeType, data }
  }

  async recognizeDetailed(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognitionDetailedResult> {
    if (boxes.length === 0) return { assignments: [], warnings: ["no_boxes_provided"] }
    const photoUrl = resolveImageUrl(photoRef, this.publicBaseUrl)
    if (!photoUrl) throw new Error("gemini_sku_photo_url_not_resolvable")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const photoImage = await this.toInlineImage(photoUrl, controller.signal)
      const response = await this.fetchImpl(
        `${this.baseUrl}/models/${encodeURIComponent(this.modelVersion)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: `${buildSkuRecognitionPrompt(boxes, catalogSkus)}\n${skuRecognitionOutputInstruction}` },
                  { text: "Shelf photo:" },
                  { inline_data: { mime_type: photoImage.mimeType, data: photoImage.data } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 4000,
              responseMimeType: "application/json",
            },
          }),
        },
      )
      const responseText = await response.text()
      if (!response.ok) {
        throw new Error(`gemini_sku_request_failed:${response.status}:${responseText.slice(0, 240)}`)
      }
      const output = skuRecognitionOutputSchema.parse(
        parseJsonObject(extractGeminiText(parseJsonObject(responseText))),
      )
      return mapSkuAssignments(boxes, catalogSkus, output)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("gemini_sku_request_timeout")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async recognize(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognizerAssignment[]> {
    return (await this.recognizeDetailed(photoRef, boxes, catalogSkus)).assignments
  }
}

export type OpenAiSkuRecognizerConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
  publicBaseUrl?: string
  timeoutMs?: number
  fetchImpl?: VisionFetch
}

export class OpenAiSkuRecognizer implements ShelfSkuRecognizerWithWarnings {
  readonly provider = OPENAI_PROVIDER
  readonly modelVersion: string

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly publicBaseUrl?: string
  private readonly timeoutMs: number
  private readonly fetchImpl: VisionFetch

  constructor(config: OpenAiSkuRecognizerConfig) {
    const apiKey = config.apiKey.trim()
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for the openai sku recognizer")
    this.modelVersion = config.model?.trim() || DEFAULT_OPENAI_VISION_MODEL
    this.apiKey = apiKey
    this.baseUrl = (config.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
    this.publicBaseUrl = config.publicBaseUrl?.trim()
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async recognizeDetailed(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognitionDetailedResult> {
    if (boxes.length === 0) return { assignments: [], warnings: ["no_boxes_provided"] }
    const photoUrl = resolveImageUrl(photoRef, this.publicBaseUrl)
    if (!photoUrl) throw new Error("openai_sku_photo_url_not_resolvable")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.modelVersion,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: buildSkuRecognitionPrompt(boxes, catalogSkus) },
                { type: "input_text", text: "Shelf photo:" },
                { type: "input_image", image_url: photoUrl },
              ],
            },
          ],
          max_output_tokens: 4000,
          text: {
            format: {
              type: "json_schema",
              name: "leadshelf_sku_recognition",
              strict: true,
              schema: skuRecognitionResponseFormatSchema,
            },
          },
        }),
      })
      const responseText = await response.text()
      if (!response.ok) {
        throw new Error(`openai_sku_request_failed:${response.status}:${responseText.slice(0, 240)}`)
      }
      const output = skuRecognitionOutputSchema.parse(
        parseJsonObject(extractOpenAiOutputText(parseJsonObject(responseText))),
      )
      return mapSkuAssignments(boxes, catalogSkus, output)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("openai_sku_request_timeout")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async recognize(
    photoRef: string,
    boxes: SkuRecognizerBoxInput[],
    catalogSkus: string[],
  ): Promise<SkuRecognizerAssignment[]> {
    return (await this.recognizeDetailed(photoRef, boxes, catalogSkus)).assignments
  }
}

export function createConfiguredSkuRecognizer(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { fetchImpl?: VisionFetch; imageFetchImpl?: VisionImageFetch } = {},
): ShelfSkuRecognizerWithWarnings {
  const provider = env.VISION_PROVIDER?.trim().toLowerCase() || "stub"
  if (provider === "stub") return new StubShelfSkuRecognizer()
  if (provider === "openai") {
    return new OpenAiSkuRecognizer({
      apiKey: env.OPENAI_API_KEY ?? "",
      model: env.OPENAI_VISION_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
      publicBaseUrl: env.VISION_PUBLIC_BASE_URL,
      timeoutMs: env.OPENAI_VISION_TIMEOUT_MS ? Number.parseInt(env.OPENAI_VISION_TIMEOUT_MS, 10) : undefined,
      fetchImpl: overrides.fetchImpl,
    })
  }
  if (provider === "gemini") {
    return new GeminiSkuRecognizer({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_VISION_MODEL,
      baseUrl: env.GEMINI_BASE_URL,
      publicBaseUrl: env.VISION_PUBLIC_BASE_URL,
      timeoutMs: env.GEMINI_VISION_TIMEOUT_MS ? Number.parseInt(env.GEMINI_VISION_TIMEOUT_MS, 10) : undefined,
      fetchImpl: overrides.fetchImpl,
      imageFetchImpl: overrides.imageFetchImpl,
    })
  }
  throw new Error(`Unsupported VISION_PROVIDER: ${provider}`)
}

export function createConfiguredVisionProvider(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { fetchImpl?: VisionFetch; imageFetchImpl?: VisionImageFetch } = {},
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
  if (provider === "gemini") {
    return new GeminiVisionProvider({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_VISION_MODEL,
      baseUrl: env.GEMINI_BASE_URL,
      publicBaseUrl: env.VISION_PUBLIC_BASE_URL,
      timeoutMs: env.GEMINI_VISION_TIMEOUT_MS ? Number.parseInt(env.GEMINI_VISION_TIMEOUT_MS, 10) : undefined,
      minConfidence: env.GEMINI_VISION_MIN_CONFIDENCE ? Number.parseFloat(env.GEMINI_VISION_MIN_CONFIDENCE) : undefined,
      fetchImpl: overrides.fetchImpl,
      imageFetchImpl: overrides.imageFetchImpl,
    })
  }
  throw new Error(`Unsupported VISION_PROVIDER: ${provider}`)
}
