import { VISION_PROTOCOL_VERSION, type VisionScanResponse } from "@leadshelf/api-contracts/vision/v1"
import {
  evaluateVisionDataset,
  evaluateVisionDetections,
  type EvalDetection,
  type VisionEvalDatasetSample,
  type VisionEvalManifest,
  type VisionEvalMetrics,
} from "./evaluation"
import { GEMINI_PROVIDER, OPENAI_PROVIDER, STUB_PROVIDER, type VisionProvider } from "./provider"

const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const
const EXTERNAL_PROVIDERS = new Set([OPENAI_PROVIDER, GEMINI_PROVIDER])

export interface VisionEvalSampleReport {
  id: string
  split: "calibration" | "validation" | "test"
  scenario: string | null
  providerStatus: VisionScanResponse["status"] | "error"
  durationMs: number
  metrics: VisionEvalMetrics | null
  detections: EvalDetection[]
  warnings: string[]
  error: string | null
}

export interface VisionEvalThresholdReport {
  minConfidence: number
  metrics: VisionEvalMetrics
  skuPrecision: number
  endToEndF1: number
}

export interface VisionEvalRunReport {
  version: 1
  datasetId: string
  provider: string
  modelVersion: string
  generatedAt: string
  costUsd: null
  samples: VisionEvalSampleReport[]
  overallMetrics: VisionEvalMetrics | null
  splitMetrics: Partial<Record<"calibration" | "validation" | "test", VisionEvalMetrics>>
  scenarioMetrics: Record<string, VisionEvalMetrics>
  calibration: {
    eligible: boolean
    blockedReason: "stub_provider" | "no_calibration_samples" | null
    sampleCount: number
    thresholdSweep: VisionEvalThresholdReport[]
    recommendedMinConfidence: number | null
    validationRequired: boolean
  }
}

type ResolvedSample = {
  report: VisionEvalSampleReport
  datasetSample: VisionEvalDatasetSample | null
}

export interface RunVisionEvalInput {
  manifest: VisionEvalManifest
  provider: VisionProvider
  resolvePhotoRef(photoRef: string): Promise<string> | string
  allowExternal?: boolean
  thresholds?: number[]
  now?: () => Date
  clockMs?: () => number
}

function expectedDetections(sample: VisionEvalManifest["samples"][number]): VisionEvalDatasetSample["expected"] {
  return sample.annotations.map((annotation) => ({
    id: annotation.id,
    productSku: annotation.productSku,
    bbox: annotation.bbox,
  }))
}

function responseDetections(sampleId: string, response: VisionScanResponse): EvalDetection[] {
  return response.detections.map((detection, index) => ({
    id: `${sampleId}:detection:${index + 1}`,
    productSku: detection.productSku,
    confidence: detection.confidence,
    bbox: detection.bbox,
  }))
}

function referenceSlots(sample: VisionEvalManifest["samples"][number]) {
  return sample.annotations.map((annotation) => ({
    id: annotation.id,
    placementId: annotation.id,
    productId: null,
    productSku: annotation.productSku,
    label: annotation.productSku,
    xPct: annotation.bbox.xPct,
    yPct: annotation.bbox.yPct,
    widthPct: annotation.bbox.widthPct,
    heightPct: annotation.bbox.heightPct,
  }))
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function thresholdReport(samples: VisionEvalDatasetSample[], minConfidence: number): VisionEvalThresholdReport {
  const filtered = samples.map((sample) => ({
    expected: sample.expected,
    actual: sample.actual.filter((detection) => detection.confidence >= minConfidence),
  }))
  const metrics = evaluateVisionDataset(filtered)
  const skuPrecision = ratio(metrics.skuCorrect, metrics.detected)
  const endToEndF1 = ratio(2 * skuPrecision * metrics.endToEndRecall, skuPrecision + metrics.endToEndRecall)
  return { minConfidence, metrics, skuPrecision, endToEndF1 }
}

function recommendedThreshold(rows: VisionEvalThresholdReport[]): number | null {
  if (rows.length === 0) return null
  return [...rows].sort(
    (a, b) =>
      b.endToEndF1 - a.endToEndF1 ||
      b.skuPrecision - a.skuPrecision ||
      a.metrics.expectedCalibrationError - b.metrics.expectedCalibrationError ||
      b.minConfidence - a.minConfidence,
  )[0]!.minConfidence
}

function aggregateBy<T extends string>(
  samples: Array<ResolvedSample & { key: T }>,
): Partial<Record<T, VisionEvalMetrics>> {
  const groups = new Map<T, VisionEvalDatasetSample[]>()
  for (const sample of samples) {
    if (!sample.datasetSample) continue
    const group = groups.get(sample.key) ?? []
    group.push(sample.datasetSample)
    groups.set(sample.key, group)
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, group]) => [key, evaluateVisionDataset(group)]),
  ) as Partial<Record<T, VisionEvalMetrics>>
}

export async function runVisionEval(input: RunVisionEvalInput): Promise<VisionEvalRunReport> {
  if (EXTERNAL_PROVIDERS.has(input.provider.metadata.provider) && !input.allowExternal) {
    throw new Error("external_vision_provider_requires_allow_external")
  }
  const now = input.now ?? (() => new Date())
  const clockMs = input.clockMs ?? (() => Date.now())
  const defaultGolden = input.manifest.samples.find((sample) => sample.goldenReferenceRef == null)
  if (!defaultGolden) throw new Error("vision_eval_missing_golden_reference_sample")

  const resolved: ResolvedSample[] = []
  for (const sample of input.manifest.samples) {
    const golden = sample.goldenReferenceRef
      ? input.manifest.samples.find((candidate) => candidate.photoRef === sample.goldenReferenceRef)
      : defaultGolden
    if (!golden) throw new Error(`vision_eval_golden_reference_not_found:${sample.id}`)

    const startedAt = clockMs()
    try {
      const photoUrl = await input.resolvePhotoRef(sample.photoRef)
      const goldenReferenceUrl = sample.goldenReferenceRef
        ? await input.resolvePhotoRef(sample.goldenReferenceRef)
        : undefined
      const response = await input.provider.scan({
        protocolVersion: VISION_PROTOCOL_VERSION,
        organizationId: "private-eval",
        planogramVersionId: sample.planogramVersionId,
        photoSubmissionId: sample.id,
        photoUrl,
        goldenReferenceId: sample.goldenReferenceRef ? golden.id : undefined,
        goldenReferenceUrl,
        slots: referenceSlots(golden),
      })
      const detections = responseDetections(sample.id, response)
      const successful = response.status !== "failed"
      const datasetSample = successful
        ? { expected: expectedDetections(sample), actual: detections }
        : null
      resolved.push({
        report: {
          id: sample.id,
          split: sample.split,
          scenario: sample.scenario ?? null,
          providerStatus: response.status,
          durationMs: Math.max(0, clockMs() - startedAt),
          metrics: datasetSample
            ? evaluateVisionDetections(datasetSample.expected, datasetSample.actual)
            : null,
          detections,
          warnings: response.warnings,
          error: null,
        },
        datasetSample,
      })
    } catch (error) {
      resolved.push({
        report: {
          id: sample.id,
          split: sample.split,
          scenario: sample.scenario ?? null,
          providerStatus: "error",
          durationMs: Math.max(0, clockMs() - startedAt),
          metrics: null,
          detections: [],
          warnings: [],
          error: error instanceof Error ? error.message : "unknown_error",
        },
        datasetSample: null,
      })
    }
  }

  const successfulSamples = resolved.flatMap((sample) => sample.datasetSample ? [sample.datasetSample] : [])
  const calibrationSamples = resolved.flatMap((sample) =>
    sample.report.split === "calibration" && sample.datasetSample ? [sample.datasetSample] : [],
  )
  const thresholds = [...new Set(input.thresholds ?? DEFAULT_THRESHOLDS)]
    .filter((threshold) => Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)
    .sort((a, b) => a - b)
  const calibrationEligible =
    input.provider.metadata.provider !== STUB_PROVIDER && calibrationSamples.length > 0
  const thresholdSweep = calibrationEligible
    ? thresholds.map((threshold) => thresholdReport(calibrationSamples, threshold))
    : []
  const splitMetrics = aggregateBy(
    resolved.map((sample) => ({ ...sample, key: sample.report.split })),
  )
  const scenarioMetrics = aggregateBy(
    resolved.map((sample) => ({ ...sample, key: sample.report.scenario ?? "unclassified" })),
  ) as Record<string, VisionEvalMetrics>

  return {
    version: 1,
    datasetId: input.manifest.datasetId,
    provider: input.provider.metadata.provider,
    modelVersion: input.provider.metadata.modelVersion,
    generatedAt: now().toISOString(),
    costUsd: null,
    samples: resolved.map((sample) => sample.report),
    overallMetrics: successfulSamples.length > 0 ? evaluateVisionDataset(successfulSamples) : null,
    splitMetrics,
    scenarioMetrics,
    calibration: {
      eligible: calibrationEligible,
      blockedReason: input.provider.metadata.provider === STUB_PROVIDER
        ? "stub_provider"
        : calibrationSamples.length === 0
          ? "no_calibration_samples"
          : null,
      sampleCount: calibrationSamples.length,
      thresholdSweep,
      recommendedMinConfidence: recommendedThreshold(thresholdSweep),
      validationRequired: !resolved.some(
        (sample) => sample.report.split === "validation" && sample.datasetSample,
      ),
    },
  }
}
