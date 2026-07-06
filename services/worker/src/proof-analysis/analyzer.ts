import {
  VISION_PROTOCOL_VERSION,
  visionScanResponseSchema,
  type VisionDetection,
  type VisionScanRequest,
  type VisionScanResponse,
} from "@leadshelf/api-contracts/vision/v1"
import { calculateShelfCompliance } from "@leadshelf/core"
import type { ExtractedProofFrame } from "./frame-extractor"

const LOCAL_STUB_PROVIDER = "leadshelf-stub"
const LOCAL_STUB_MODEL_VERSION = "stub-selected-frames-v1"

export interface ProofAiFinding {
  type:
    | "sku_missing"
    | "wrong_shelf"
    | "wrong_order"
    | "facing_mismatch"
    | "logo_not_front"
    | "depth_not_confirmed"
    | "empty_back_row"
    | "price_tag_missing"
    | "manual_review_required"
  severity: "info" | "warning" | "critical"
  slotId: string | null
  productSku: string | null
  evidenceFrameTimestampMs: number | null
  note: string
}

export interface ProofFrameAnalysisResult {
  response: VisionScanResponse
  aiFindings: ProofAiFinding[]
  rawSummary: string | null
}

function localSelectedFrameScan(request: VisionScanRequest, frames: ExtractedProofFrame[]): ProofFrameAnalysisResult {
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
    response: {
      protocolVersion: VISION_PROTOCOL_VERSION,
      provider: LOCAL_STUB_PROVIDER,
      modelVersion: LOCAL_STUB_MODEL_VERSION,
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
        frames.length > 0
          ? "stub_provider_did_not_perform_real_image_inference"
          : "no_selected_frames_provided",
      ],
    },
    aiFindings: [
      {
        type: "manual_review_required",
        severity: "warning",
        slotId: null,
        productSku: null,
        evidenceFrameTimestampMs: frames[0]?.timestampMs ?? null,
        note: "OpenAI provider is not enabled; selected frames were extracted for manual review.",
      },
    ],
    rawSummary: "Selected frames extracted; OpenAI analysis not enabled.",
  }
}

const proofAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "detections", "findings", "depthConfirmed", "warnings"],
  properties: {
    status: { type: "string", enum: ["PASS", "REVIEW", "FAIL"] },
    summary: { type: "string" },
    depthConfirmed: { type: "boolean" },
    detections: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slotId", "productSku", "label", "confidence", "bbox"],
        properties: {
          slotId: { type: ["string", "null"] },
          productSku: { type: ["string", "null"] },
          label: { type: ["string", "null"] },
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
    findings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "severity", "slotId", "productSku", "evidenceFrameTimestampMs", "note"],
        properties: {
          type: {
            type: "string",
            enum: [
              "sku_missing",
              "wrong_shelf",
              "wrong_order",
              "facing_mismatch",
              "logo_not_front",
              "depth_not_confirmed",
              "empty_back_row",
              "price_tag_missing",
              "manual_review_required",
            ],
          },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          slotId: { type: ["string", "null"] },
          productSku: { type: ["string", "null"] },
          evidenceFrameTimestampMs: { type: ["number", "null"] },
          note: { type: "string" },
        },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 50,
    },
  },
}

interface OpenAIProofAnalysisBody {
  status: "PASS" | "REVIEW" | "FAIL"
  summary: string
  depthConfirmed: boolean
  detections: Array<{
    slotId: string | null
    productSku: string | null
    label: string | null
    confidence: number
    bbox: { xPct: number; yPct: number; widthPct: number; heightPct: number }
  }>
  findings: ProofAiFinding[]
  warnings: string[]
}

function extractOutputText(body: unknown): string | null {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (typeof record.output_text === "string") return record.output_text
  const output = Array.isArray(record.output) ? record.output : []
  for (const item of output) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : null
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const partRecord = part && typeof part === "object" ? (part as Record<string, unknown>) : {}
      if (typeof partRecord.text === "string") return partRecord.text
      if (typeof partRecord.output_text === "string") return partRecord.output_text
    }
  }
  return null
}

function parseOpenAIAnalysis(body: unknown): OpenAIProofAnalysisBody {
  const text = extractOutputText(body)
  if (!text) throw new Error("openai_response_missing_output_text")
  const parsed = JSON.parse(text) as OpenAIProofAnalysisBody
  if (!Array.isArray(parsed.detections) || !Array.isArray(parsed.findings) || !Array.isArray(parsed.warnings)) {
    throw new Error("openai_response_invalid_shape")
  }
  return parsed
}

function framePrompt(request: VisionScanRequest, frames: ExtractedProofFrame[]): string {
  const slots = request.slots.map((slot) => ({
    slotId: slot.id,
    productSku: slot.productSku,
    label: slot.label,
    expectedBoxPct: {
      x: slot.xPct,
      y: slot.yPct,
      width: slot.widthPct,
      height: slot.heightPct,
    },
  }))
  return JSON.stringify({
    task: "Analyze shelf proof frames against the planogram slots. Do not claim depth if back rows are not visible.",
    requiredChecks: [
      "sku_missing",
      "wrong_shelf",
      "wrong_order",
      "facing_mismatch",
      "logo_not_front",
      "depth_not_confirmed",
      "empty_back_row",
      "price_tag_missing",
      "manual_review_required",
    ],
    frames: frames.map((frame, index) => ({ index, timestampMs: frame.timestampMs })),
    slots,
  })
}

async function scanWithOpenAI(request: VisionScanRequest, frames: ExtractedProofFrame[]): Promise<ProofFrameAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("openai_api_key_missing")

  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini"
  const endpoint = process.env.OPENAI_RESPONSES_URL ?? "https://api.openai.com/v1/responses"
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a retail shelf compliance auditor. Return only structured JSON. Be conservative: if visual evidence is unclear, mark manual_review_required or depth_not_confirmed.",
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: framePrompt(request, frames) },
            ...frames.map((frame) => ({
              type: "input_image",
              image_url: `data:image/jpeg;base64,${frame.buffer.toString("base64")}`,
              detail: "high",
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "shelf_proof_analysis",
          strict: true,
          schema: proofAnalysisSchema,
        },
      },
    }),
  })
  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(`openai_responses_failed:${response.status}:${message.slice(0, 500)}`)
  }

  const parsed = parseOpenAIAnalysis(await response.json())
  const slotById = new Map(request.slots.map((slot) => [slot.id, slot]))
  const detections: VisionDetection[] = parsed.detections.map((detection) => {
    const slot = detection.slotId ? slotById.get(detection.slotId) : null
    const skuMatchesSlot = slot?.productSku && detection.productSku === slot.productSku
    return {
      slotId: detection.slotId,
      productId: skuMatchesSlot ? slot.productId : null,
      productSku: detection.productSku,
      label: detection.label,
      confidence: detection.confidence,
      bbox: detection.bbox,
    }
  })
  const complianceResult = calculateShelfCompliance({
    slots: request.slots.map((slot) => ({
      id: slot.id,
      productId: slot.productId,
      productSku: slot.productSku,
    })),
    detections,
  })
  const warnings = [
    ...parsed.warnings,
    ...(parsed.depthConfirmed ? [] : ["depth_not_confirmed_by_selected_frames"]),
  ]

  return {
    response: visionScanResponseSchema.parse({
      protocolVersion: VISION_PROTOCOL_VERSION,
      provider: "openai",
      modelVersion: model,
      status: complianceResult.status === "PASS" && parsed.status === "PASS" ? "completed" : "needs_human_review",
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
    }),
    aiFindings: parsed.findings,
    rawSummary: parsed.summary,
  }
}

export async function analyzeSelectedProofFrames(
  request: VisionScanRequest,
  frames: ExtractedProofFrame[],
): Promise<ProofFrameAnalysisResult> {
  const provider = process.env.LEADSHELF_PROOF_AI_PROVIDER ?? process.env.VISION_PROVIDER ?? "stub"
  if (provider === "openai") return scanWithOpenAI(request, frames)
  return localSelectedFrameScan(request, frames)
}
