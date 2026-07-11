import { z } from "zod"

const bboxSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100),
  heightPct: z.number().positive().max(100),
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
    annotations: z.array(z.object({
      id: z.string().min(1),
      productSku: z.string().min(1),
      bbox: bboxSchema,
      facings: z.number().int().min(1),
    })),
  })),
})
export type VisionEvalManifest = z.infer<typeof visionEvalManifestSchema>

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
export function evaluateVisionDetections(
  expected: Array<Omit<EvalDetection, "confidence">>,
  actual: EvalDetection[],
  iouThreshold = 0.5,
): VisionEvalMetrics {
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
