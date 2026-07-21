import { z } from "zod"
import type { ShelfLocalizer } from "./evaluation"
import type { VisionFetch } from "./provider"

export const LOCATE_ANYTHING_PROVIDER = "nvidia-locateanything-eval"
export const DEFAULT_LOCATE_ANYTHING_MODEL = "nvidia/LocateAnything-3B"
export const DEFAULT_LOCATE_ANYTHING_QUERY = "retail product package"

const locateAnythingResponseSchema = z.object({
  evaluationOnly: z.literal(true),
  model: z.string().min(1),
  boxes: z.array(
    z.object({
      label: z.string().optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      x1: z.number().min(0).max(1000),
      y1: z.number().min(0).max(1000),
      x2: z.number().min(0).max(1000),
      y2: z.number().min(0).max(1000),
    }),
  ).max(2000),
})

export type LocateAnythingLocalizerConfig = {
  evaluationOnlyAccepted: boolean
  baseUrl?: string
  token?: string
  model?: string
  query?: string
  generationMode?: "fast" | "hybrid" | "slow"
  timeoutMs?: number
  uncalibratedConfidence?: number
  fetchImpl?: VisionFetch
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
}

function parseBoundedNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Evaluation-only localizer for the non-commercial LocateAnything-3B weights.
 * It is deliberately not a VisionProvider and is never selected by the
 * production VISION_PROVIDER factory.
 */
export class LocateAnythingLocalizer implements ShelfLocalizer {
  readonly provider = LOCATE_ANYTHING_PROVIDER
  readonly modelVersion: string

  private readonly endpoint: string
  private readonly token?: string
  private readonly query: string
  private readonly generationMode: "fast" | "hybrid" | "slow"
  private readonly timeoutMs: number
  private readonly uncalibratedConfidence: number
  private readonly fetchImpl: VisionFetch

  constructor(config: LocateAnythingLocalizerConfig) {
    if (!config.evaluationOnlyAccepted) {
      throw new Error("locateanything_requires_noncommercial_evaluation_ack")
    }
    const baseUrl = new URL(config.baseUrl?.trim() || "http://127.0.0.1:8091")
    const token = config.token?.trim() || undefined
    if (!isLoopback(baseUrl.hostname) && baseUrl.protocol !== "https:") {
      throw new Error("locateanything_remote_worker_requires_https")
    }
    if (!isLoopback(baseUrl.hostname) && !token) {
      throw new Error("locateanything_remote_worker_requires_token")
    }
    const confidence = config.uncalibratedConfidence ?? 0.5
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("locateanything_uncalibrated_confidence_out_of_range")
    }

    this.endpoint = `${baseUrl.toString().replace(/\/+$/, "")}/v1/localize`
    this.token = token
    this.modelVersion = config.model?.trim() || DEFAULT_LOCATE_ANYTHING_MODEL
    this.query = config.query?.trim() || DEFAULT_LOCATE_ANYTHING_QUERY
    this.generationMode = config.generationMode ?? "hybrid"
    this.timeoutMs = config.timeoutMs ?? 120_000
    this.uncalibratedConfidence = confidence
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async localize(photoRef: string) {
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(photoRef)) {
      throw new Error("locateanything_eval_requires_inline_image")
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (this.token) headers.Authorization = `Bearer ${this.token}`
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          evaluationOnly: true,
          model: this.modelVersion,
          imageDataUrl: photoRef,
          categories: [this.query],
          generationMode: this.generationMode,
        }),
      })
      const responseText = await response.text()
      if (!response.ok) throw new Error(`locateanything_worker_request_failed:${response.status}`)
      const parsed = locateAnythingResponseSchema.parse(JSON.parse(responseText))
      if (parsed.model !== this.modelVersion) {
        throw new Error("locateanything_worker_model_mismatch")
      }
      return parsed.boxes.flatMap((box, index) => {
        if (box.x2 <= box.x1 || box.y2 <= box.y1) return []
        return [{
          id: `locateanything-${index + 1}`,
          confidence: box.confidence ?? this.uncalibratedConfidence,
          bbox: {
            xPct: box.x1 / 10,
            yPct: box.y1 / 10,
            widthPct: (box.x2 - box.x1) / 10,
            heightPct: (box.y2 - box.y1) / 10,
          },
        }]
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("locateanything_worker_request_timeout")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createConfiguredLocateAnythingLocalizer(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { fetchImpl?: VisionFetch } = {},
): LocateAnythingLocalizer {
  const accepted = ["1", "true"].includes(
    env.LOCATEANYTHING_NONCOMMERCIAL_EVALUATION_ONLY?.trim().toLowerCase() ?? "",
  )
  const mode = env.LOCATEANYTHING_GENERATION_MODE?.trim().toLowerCase()
  if (mode && mode !== "fast" && mode !== "hybrid" && mode !== "slow") {
    throw new Error(`invalid_locateanything_generation_mode:${mode}`)
  }
  return new LocateAnythingLocalizer({
    evaluationOnlyAccepted: accepted,
    baseUrl: env.LOCATEANYTHING_WORKER_URL,
    token: env.LOCATEANYTHING_WORKER_TOKEN,
    model: env.LOCATEANYTHING_MODEL,
    query: env.LOCATEANYTHING_QUERY,
    generationMode: mode as "fast" | "hybrid" | "slow" | undefined,
    timeoutMs: parseBoundedNumber(env.LOCATEANYTHING_TIMEOUT_MS, 120_000),
    uncalibratedConfidence: parseBoundedNumber(env.LOCATEANYTHING_UNCALIBRATED_CONFIDENCE, 0.5),
    fetchImpl: overrides.fetchImpl,
  })
}
