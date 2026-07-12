import { z } from "zod"

const bboxSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100),
  heightPct: z.number().positive().max(100),
})

const evalScenarioSchema = z.enum([
  "golden",
  "missing_sku",
  "wrong_position",
  "perspective",
  "extra_facing",
  "rotated_label",
  "partial_occlusion",
  "low_light",
  "blur",
])

const recognitionConditionSchema = z.enum(["clear", "rotated_label", "partial_occlusion", "occluded"])

export const visionEvalAnnotationSchema = z.object({
  id: z.string().min(1),
  productSku: z.string().min(1),
  bbox: bboxSchema,
  facings: z.number().int().min(1),
  recognitionCondition: recognitionConditionSchema.default("clear"),
})

export const visionEvalManifestSchema = z.object({
  version: z.literal(1),
  datasetId: z.string().min(1),
  createdAt: z.string().datetime(),
  samples: z.array(z.object({
    id: z.string().min(1),
    split: z.enum(["calibration", "validation", "test"]),
    photoRef: z.string().min(1),
    goldenReferenceRef: z.string().min(1).nullable(),
    planogramVersionId: z.string().min(1),
    scenario: evalScenarioSchema.optional(),
    // Только samples с sourceKind="real" учитываются в accuracy-claims гейте;
    // synthetic допустим для wiring/regression, но не для заявлений о точности.
    sourceKind: z.enum(["real", "synthetic"]).optional(),
    notes: z.string().max(500).optional(),
    annotations: z.array(visionEvalAnnotationSchema),
  })),
})
export type VisionEvalManifest = z.infer<typeof visionEvalManifestSchema>
export type VisionEvalSplit = VisionEvalManifest["samples"][number]["split"]

export interface VisionEvalManifestStats {
  sampleCount: number
  annotationCount: number
  bySplit: Record<VisionEvalSplit, number>
  bySourceKind: { real: number; synthetic: number; unspecified: number }
  byScenario: Record<string, number>
  byRecognitionCondition: Record<string, number>
}

/**
 * Дисциплина датасета живёт рядом со схемой: схема проверяет форму, эти
 * helpers — целостность (дубликаты, leakage фото между сплитами, наличие
 * default golden-сэмпла, который требует runner).
 */
export function validateVisionEvalManifest(manifest: VisionEvalManifest): string[] {
  const issues: string[] = []
  const sampleIds = new Set<string>()
  const splitByPhotoRef = new Map<string, VisionEvalSplit>()
  for (const sample of manifest.samples) {
    if (sampleIds.has(sample.id)) issues.push(`duplicate_sample_id:${sample.id}`)
    sampleIds.add(sample.id)
    const previousSplit = splitByPhotoRef.get(sample.photoRef)
    if (previousSplit && previousSplit !== sample.split) {
      issues.push(`photo_ref_split_leakage:${sample.photoRef}:${previousSplit}:${sample.split}`)
    }
    splitByPhotoRef.set(sample.photoRef, sample.split)
    const annotationIds = new Set<string>()
    for (const annotation of sample.annotations) {
      if (annotationIds.has(annotation.id)) {
        issues.push(`duplicate_annotation_id:${sample.id}:${annotation.id}`)
      }
      annotationIds.add(annotation.id)
    }
  }
  if (!manifest.samples.some((sample) => sample.goldenReferenceRef == null)) {
    issues.push("missing_default_golden_reference_sample")
  }
  for (const sample of manifest.samples) {
    if (
      sample.goldenReferenceRef != null &&
      !manifest.samples.some((candidate) => candidate.photoRef === sample.goldenReferenceRef)
    ) {
      issues.push(`golden_reference_not_found:${sample.id}:${sample.goldenReferenceRef}`)
    }
  }
  return issues
}

export function visionEvalManifestStats(manifest: VisionEvalManifest): VisionEvalManifestStats {
  const stats: VisionEvalManifestStats = {
    sampleCount: manifest.samples.length,
    annotationCount: 0,
    bySplit: { calibration: 0, validation: 0, test: 0 },
    bySourceKind: { real: 0, synthetic: 0, unspecified: 0 },
    byScenario: {},
    byRecognitionCondition: {},
  }
  for (const sample of manifest.samples) {
    stats.annotationCount += sample.annotations.length
    stats.bySplit[sample.split] += 1
    stats.bySourceKind[sample.sourceKind ?? "unspecified"] += 1
    const scenario = sample.scenario ?? "unclassified"
    stats.byScenario[scenario] = (stats.byScenario[scenario] ?? 0) + 1
    for (const annotation of sample.annotations) {
      stats.byRecognitionCondition[annotation.recognitionCondition] =
        (stats.byRecognitionCondition[annotation.recognitionCondition] ?? 0) + 1
    }
  }
  return stats
}

export interface EvalDetection {
  id: string
  productSku: string | null
  confidence: number
  bbox: z.infer<typeof bboxSchema>
}

export interface VisionEvalMetrics {
  expected: number
  detected: number
  localized: number
  skuCorrect: number
  localizationPrecision: number
  localizationRecall: number
  skuAccuracyOnLocalized: number
  endToEndRecall: number
  meanIou: number
  expectedCalibrationError: number
}

export interface VisionEvalDatasetSample {
  expected: Array<Omit<EvalDetection, "confidence">>
  actual: EvalDetection[]
}

function intersectionOverUnion(a: EvalDetection["bbox"], b: EvalDetection["bbox"]): number {
  const left = Math.max(a.xPct, b.xPct)
  const top = Math.max(a.yPct, b.yPct)
  const right = Math.min(a.xPct + a.widthPct, b.xPct + b.widthPct)
  const bottom = Math.min(a.yPct + a.heightPct, b.yPct + b.heightPct)
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.widthPct * a.heightPct + b.widthPct * b.heightPct - intersection
  return union <= 0 ? 0 : intersection / union
}

function calibrationError(rows: Array<{ confidence: number; correct: boolean }>): number {
  if (rows.length === 0) return 0
  let weighted = 0
  for (let bin = 0; bin < 10; bin += 1) {
    const min = bin / 10
    const max = (bin + 1) / 10
    const bucket = rows.filter((row) => row.confidence >= min && (bin === 9 ? row.confidence <= max : row.confidence < max))
    if (bucket.length === 0) continue
    const confidence = bucket.reduce((sum, row) => sum + row.confidence, 0) / bucket.length
    const accuracy = bucket.filter((row) => row.correct).length / bucket.length
    weighted += (bucket.length / rows.length) * Math.abs(accuracy - confidence)
  }
  return weighted
}

/**
 * Greedy one-to-one localization matching keeps localization and SKU quality
 * separate. Threshold calibration must happen on the calibration split only.
 */
function evaluateVisionDetectionDetails(
  expected: Array<Omit<EvalDetection, "confidence">>,
  actual: EvalDetection[],
  iouThreshold = 0.5,
): { metrics: VisionEvalMetrics; calibrationRows: Array<{ confidence: number; correct: boolean }> } {
  const candidates = expected.flatMap((target, expectedIndex) =>
    actual.map((detection, actualIndex) => ({
      expectedIndex,
      actualIndex,
      iou: intersectionOverUnion(target.bbox, detection.bbox),
    })),
  ).filter((candidate) => candidate.iou >= iouThreshold)
    .sort((a, b) => b.iou - a.iou || a.expectedIndex - b.expectedIndex || a.actualIndex - b.actualIndex)
  const usedExpected = new Set<number>()
  const usedActual = new Set<number>()
  const matches: typeof candidates = []
  for (const candidate of candidates) {
    if (usedExpected.has(candidate.expectedIndex) || usedActual.has(candidate.actualIndex)) continue
    usedExpected.add(candidate.expectedIndex)
    usedActual.add(candidate.actualIndex)
    matches.push(candidate)
  }
  const skuCorrect = matches.filter(({ expectedIndex, actualIndex }) =>
    expected[expectedIndex]!.productSku === actual[actualIndex]!.productSku).length
  const calibrationRows = actual.map((detection, actualIndex) => {
    const match = matches.find((candidate) => candidate.actualIndex === actualIndex)
    return {
      confidence: Math.max(0, Math.min(1, detection.confidence)),
      correct: Boolean(match && expected[match.expectedIndex]!.productSku === detection.productSku),
    }
  })
  const ratio = (numerator: number, denominator: number) => denominator === 0 ? 0 : numerator / denominator
  return {
    metrics: {
      expected: expected.length,
      detected: actual.length,
      localized: matches.length,
      skuCorrect,
      localizationPrecision: ratio(matches.length, actual.length),
      localizationRecall: ratio(matches.length, expected.length),
      skuAccuracyOnLocalized: ratio(skuCorrect, matches.length),
      endToEndRecall: ratio(skuCorrect, expected.length),
      meanIou: ratio(matches.reduce((sum, match) => sum + match.iou, 0), matches.length),
      expectedCalibrationError: calibrationError(calibrationRows),
    },
    calibrationRows,
  }
}

export function evaluateVisionDetections(
  expected: Array<Omit<EvalDetection, "confidence">>,
  actual: EvalDetection[],
  iouThreshold = 0.5,
): VisionEvalMetrics {
  return evaluateVisionDetectionDetails(expected, actual, iouThreshold).metrics
}

export function evaluateVisionDataset(
  samples: VisionEvalDatasetSample[],
  iouThreshold = 0.5,
): VisionEvalMetrics {
  const details = samples.map((sample) =>
    evaluateVisionDetectionDetails(sample.expected, sample.actual, iouThreshold),
  )
  const totals = details.reduce(
    (result, detail) => ({
      expected: result.expected + detail.metrics.expected,
      detected: result.detected + detail.metrics.detected,
      localized: result.localized + detail.metrics.localized,
      skuCorrect: result.skuCorrect + detail.metrics.skuCorrect,
      iouSum: result.iouSum + detail.metrics.meanIou * detail.metrics.localized,
    }),
    { expected: 0, detected: 0, localized: 0, skuCorrect: 0, iouSum: 0 },
  )
  const calibrationRows = details.flatMap((detail) => detail.calibrationRows)
  const ratio = (numerator: number, denominator: number) => denominator === 0 ? 0 : numerator / denominator
  return {
    expected: totals.expected,
    detected: totals.detected,
    localized: totals.localized,
    skuCorrect: totals.skuCorrect,
    localizationPrecision: ratio(totals.localized, totals.detected),
    localizationRecall: ratio(totals.localized, totals.expected),
    skuAccuracyOnLocalized: ratio(totals.skuCorrect, totals.localized),
    endToEndRecall: ratio(totals.skuCorrect, totals.expected),
    meanIou: ratio(totals.iouSum, totals.localized),
    expectedCalibrationError: calibrationError(calibrationRows),
  }
}

export interface ShelfLocalizer {
  readonly provider: string
  readonly modelVersion: string
  localize(photoRef: string): Promise<Array<{ id: string; confidence: number; bbox: EvalDetection["bbox"] }>>
}

export interface ShelfSkuRecognizer {
  readonly provider: string
  readonly modelVersion: string
  recognize(
    photoRef: string,
    boxes: Array<{ id: string; bbox: EvalDetection["bbox"] }>,
    catalogSkus: string[],
  ): Promise<Array<{ id: string; productSku: string | null; confidence: number }>>
}

export async function runTwoStageShelfRecognition(
  localizer: ShelfLocalizer,
  recognizer: ShelfSkuRecognizer,
  input: { photoRef: string; catalogSkus: string[] },
): Promise<EvalDetection[]> {
  const boxes = await localizer.localize(input.photoRef)
  const recognized = await recognizer.recognize(input.photoRef, boxes, input.catalogSkus)
  const byId = new Map(recognized.map((row) => [row.id, row]))
  return boxes.map((box) => ({
    id: box.id,
    bbox: box.bbox,
    productSku: byId.get(box.id)?.productSku ?? null,
    confidence: Math.min(box.confidence, byId.get(box.id)?.confidence ?? 0),
  }))
}
