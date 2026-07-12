import { VISION_PROTOCOL_VERSION, type VisionScanResponse } from "@leadshelf/api-contracts/vision/v1"
import {
  evaluateVisionDataset,
  evaluateVisionDetections,
  runTwoStageShelfRecognition,
  type EvalDetection,
  type ShelfLocalizer,
  type VisionEvalDatasetSample,
  type VisionEvalManifest,
  type VisionEvalMetrics,
  type VisionEvalSplit,
} from "./evaluation"
import {
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  STUB_PROVIDER,
  type ShelfSkuRecognizerWithWarnings,
  type VisionProvider,
} from "./provider"

const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const
const EXTERNAL_PROVIDERS = new Set([OPENAI_PROVIDER, GEMINI_PROVIDER])
const ALL_SPLITS: VisionEvalSplit[] = ["calibration", "validation", "test"]
// Минимум успешных REAL-сэмплов в validation/test, ниже которого отчёт
// машинно запрещает accuracy-claims. Порог — проектное решение (roadmap
// Фаза 8: «не заявлять accuracy без реальных размеченных фото»); поднять
// можно, опустить — только решением владельца.
const MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS = 20

export type VisionEvalMode = "end_to_end" | "oracle_boxes" | "two_stage"

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
  mode: VisionEvalMode
  generatedAt: string
  costUsd: null
  requestedSplits: VisionEvalSplit[]
  includedSplits: VisionEvalSplit[]
  testIncluded: boolean
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
  // «Не заявлять production accuracy без репрезентативного eval» — машинно:
  // allowed=true только когда провайдер не stub И в validation/test набралось
  // достаточно успешных сэмплов с sourceKind="real".
  accuracyClaims: {
    allowed: boolean
    blockedReason: "stub_provider" | "insufficient_real_validation_samples" | null
    realValidationSampleCount: number
    minimumRequired: number
  }
}

type ResolvedSample = {
  report: VisionEvalSampleReport
  datasetSample: VisionEvalDatasetSample | null
}

export interface RunVisionEvalInput {
  manifest: VisionEvalManifest
  // end_to_end использует provider.scan; oracle_boxes — recognizer по
  // human-боксам; two_stage — localizer + recognizer (пока stub-wiring).
  mode?: VisionEvalMode
  provider?: VisionProvider
  recognizer?: ShelfSkuRecognizerWithWarnings
  localizer?: ShelfLocalizer
  // Какие сплиты исполнять. По умолчанию — все (библиотечное поведение);
  // дисциплина «test только по явному запросу» живёт в eval-cli.
  splits?: VisionEvalSplit[]
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

function activeStageMetadata(input: RunVisionEvalInput, mode: VisionEvalMode): {
  provider: string
  modelVersion: string
  externalProviders: string[]
} {
  if (mode === "end_to_end") {
    if (!input.provider) throw new Error("vision_eval_mode_requires_provider:end_to_end")
    return {
      provider: input.provider.metadata.provider,
      modelVersion: input.provider.metadata.modelVersion,
      externalProviders: [input.provider.metadata.provider],
    }
  }
  if (mode === "oracle_boxes") {
    if (!input.recognizer) throw new Error("vision_eval_mode_requires_recognizer:oracle_boxes")
    return {
      provider: input.recognizer.provider,
      modelVersion: input.recognizer.modelVersion,
      externalProviders: [input.recognizer.provider],
    }
  }
  if (!input.localizer || !input.recognizer) {
    throw new Error("vision_eval_mode_requires_localizer_and_recognizer:two_stage")
  }
  return {
    provider: `${input.localizer.provider}+${input.recognizer.provider}`,
    modelVersion: `${input.localizer.modelVersion}+${input.recognizer.modelVersion}`,
    externalProviders: [input.localizer.provider, input.recognizer.provider],
  }
}

export async function runVisionEval(input: RunVisionEvalInput): Promise<VisionEvalRunReport> {
  const mode: VisionEvalMode = input.mode ?? "end_to_end"
  const stage = activeStageMetadata(input, mode)
  if (stage.externalProviders.some((provider) => EXTERNAL_PROVIDERS.has(provider)) && !input.allowExternal) {
    throw new Error("external_vision_provider_requires_allow_external")
  }
  const now = input.now ?? (() => new Date())
  const clockMs = input.clockMs ?? (() => Date.now())
  // Golden-референсы резолвятся по ПОЛНОМУ манифесту: golden-сэмпл может
  // лежать в сплите, который в этот прогон не исполняется.
  const defaultGolden = input.manifest.samples.find((sample) => sample.goldenReferenceRef == null)
  if (!defaultGolden) throw new Error("vision_eval_missing_golden_reference_sample")

  const requestedSplits = [...new Set(input.splits ?? ALL_SPLITS)]
  const runSamples = input.manifest.samples.filter((sample) => requestedSplits.includes(sample.split))

  const resolved: ResolvedSample[] = []
  for (const sample of runSamples) {
    const golden = sample.goldenReferenceRef
      ? input.manifest.samples.find((candidate) => candidate.photoRef === sample.goldenReferenceRef)
      : defaultGolden
    if (!golden) throw new Error(`vision_eval_golden_reference_not_found:${sample.id}`)

    const startedAt = clockMs()
    try {
      const photoUrl = await input.resolvePhotoRef(sample.photoRef)
      let providerStatus: VisionEvalSampleReport["providerStatus"]
      let detections: EvalDetection[]
      let warnings: string[]

      if (mode === "end_to_end") {
        const goldenReferenceUrl = sample.goldenReferenceRef
          ? await input.resolvePhotoRef(sample.goldenReferenceRef)
          : undefined
        const response = await input.provider!.scan({
          protocolVersion: VISION_PROTOCOL_VERSION,
          organizationId: "private-eval",
          planogramVersionId: sample.planogramVersionId,
          photoSubmissionId: sample.id,
          photoUrl,
          goldenReferenceId: sample.goldenReferenceRef ? golden.id : undefined,
          goldenReferenceUrl,
          slots: referenceSlots(golden),
        })
        providerStatus = response.status
        detections = responseDetections(sample.id, response)
        warnings = response.warnings
      } else {
        // Кандидаты SKU — из golden-сэмпла (планограммная выкладка), не из
        // всего каталога: дешевле и не даёт классификатору чужих ответов.
        const catalogSkus = [...new Set(golden.annotations.map((annotation) => annotation.productSku))]
        if (mode === "oracle_boxes") {
          // Human-боксы как оракул локализации: метрика изолирует чистую
          // SKU-классификацию (localization по построению = 1.0).
          const boxes = sample.annotations.map((annotation) => ({
            id: annotation.id,
            bbox: annotation.bbox,
          }))
          const detailed = await input.recognizer!.recognizeDetailed(photoUrl, boxes, catalogSkus)
          const byId = new Map(detailed.assignments.map((row) => [row.id, row]))
          providerStatus = "completed"
          detections = boxes.map((box) => ({
            id: box.id,
            bbox: box.bbox,
            productSku: byId.get(box.id)?.productSku ?? null,
            confidence: byId.get(box.id)?.confidence ?? 0,
          }))
          warnings = detailed.warnings
        } else {
          const staged = await runTwoStageShelfRecognition(input.localizer!, input.recognizer!, {
            photoRef: photoUrl,
            catalogSkus,
          })
          providerStatus = "completed"
          detections = staged
          warnings = []
        }
      }

      const successful = providerStatus !== "failed"
      const datasetSample = successful
        ? { expected: expectedDetections(sample), actual: detections }
        : null
      resolved.push({
        report: {
          id: sample.id,
          split: sample.split,
          scenario: sample.scenario ?? null,
          providerStatus,
          durationMs: Math.max(0, clockMs() - startedAt),
          metrics: datasetSample
            ? evaluateVisionDetections(datasetSample.expected, datasetSample.actual)
            : null,
          detections,
          warnings,
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
  // Sweep порогов ЖЁСТКО фильтруется по calibration независимо от того,
  // какие сплиты запрошены в этом прогоне.
  const calibrationSamples = resolved.flatMap((sample) =>
    sample.report.split === "calibration" && sample.datasetSample ? [sample.datasetSample] : [],
  )
  const thresholds = [...new Set(input.thresholds ?? DEFAULT_THRESHOLDS)]
    .filter((threshold) => Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)
    .sort((a, b) => a - b)
  const stubActive = stage.externalProviders.includes(STUB_PROVIDER)
  const calibrationEligible = !stubActive && calibrationSamples.length > 0
  const thresholdSweep = calibrationEligible
    ? thresholds.map((threshold) => thresholdReport(calibrationSamples, threshold))
    : []
  const splitMetrics = aggregateBy(
    resolved.map((sample) => ({ ...sample, key: sample.report.split })),
  )
  const scenarioMetrics = aggregateBy(
    resolved.map((sample) => ({ ...sample, key: sample.report.scenario ?? "unclassified" })),
  ) as Record<string, VisionEvalMetrics>

  const sourceKindById = new Map(
    input.manifest.samples.map((sample) => [sample.id, sample.sourceKind ?? "unspecified"]),
  )
  const realValidationSampleCount = resolved.filter(
    (sample) =>
      (sample.report.split === "validation" || sample.report.split === "test") &&
      sample.datasetSample != null &&
      sourceKindById.get(sample.report.id) === "real",
  ).length
  const includedSplits = ALL_SPLITS.filter((split) =>
    resolved.some((sample) => sample.report.split === split),
  )

  return {
    version: 1,
    datasetId: input.manifest.datasetId,
    provider: stage.provider,
    modelVersion: stage.modelVersion,
    mode,
    generatedAt: now().toISOString(),
    costUsd: null,
    requestedSplits,
    includedSplits,
    testIncluded: includedSplits.includes("test"),
    samples: resolved.map((sample) => sample.report),
    overallMetrics: successfulSamples.length > 0 ? evaluateVisionDataset(successfulSamples) : null,
    splitMetrics,
    scenarioMetrics,
    calibration: {
      eligible: calibrationEligible,
      blockedReason: stubActive
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
    accuracyClaims: {
      allowed: !stubActive && realValidationSampleCount >= MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS,
      blockedReason: stubActive
        ? "stub_provider"
        : realValidationSampleCount < MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS
          ? "insufficient_real_validation_samples"
          : null,
      realValidationSampleCount,
      minimumRequired: MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS,
    },
  }
}
