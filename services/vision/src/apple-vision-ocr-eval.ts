import { z } from "zod"
import type { VisionEvalManifest } from "./evaluation"

const appleVisionOcrRowSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
})

export const appleVisionOcrRowsSchema = z.array(appleVisionOcrRowSchema)
export type AppleVisionOcrRow = z.infer<typeof appleVisionOcrRowSchema>

export interface AppleVisionOcrEvidenceMetrics {
  expectedBoxes: number
  boxesWithText: number
  textEvidenceRecall: number
}

export interface AppleVisionOcrEvalReport {
  version: 1
  datasetId: string
  provider: "apple-vision-ocr"
  modelVersion: "VNRecognizeTextRequest-accurate"
  mode: "oracle-box-text-evidence"
  oracleLocalization: true
  generatedAt: string
  overallMetrics: AppleVisionOcrEvidenceMetrics
  scenarioMetrics: Record<string, AppleVisionOcrEvidenceMetrics>
  conditionMetrics: Record<string, AppleVisionOcrEvidenceMetrics>
  samples: Array<{
    id: string
    scenario: string | null
    metrics: AppleVisionOcrEvidenceMetrics
    annotations: Array<{
      id: string
      productSku: string
      recognitionCondition: string
      texts: string[]
      maxConfidence: number | null
    }>
  }>
}

export interface EvaluateAppleVisionOcrInput {
  manifest: VisionEvalManifest
  loadRows(sampleId: string): Promise<AppleVisionOcrRow[]> | AppleVisionOcrRow[]
  now?: () => Date
}

function evidenceMetrics(rows: Array<{ hasText: boolean }>): AppleVisionOcrEvidenceMetrics {
  const expectedBoxes = rows.length
  const boxesWithText = rows.filter((row) => row.hasText).length
  return {
    expectedBoxes,
    boxesWithText,
    textEvidenceRecall: expectedBoxes === 0 ? 0 : boxesWithText / expectedBoxes,
  }
}

function rowsInsideAnnotation(
  rows: AppleVisionOcrRow[],
  bbox: { xPct: number; yPct: number; widthPct: number; heightPct: number },
): AppleVisionOcrRow[] {
  const left = bbox.xPct / 100
  const top = bbox.yPct / 100
  const right = left + bbox.widthPct / 100
  const bottom = top + bbox.heightPct / 100
  return rows.filter((row) => {
    const centerX = row.x + row.width / 2
    const centerYFromTop = 1 - (row.y + row.height / 2)
    return centerX >= left && centerX <= right && centerYFromTop >= top && centerYFromTop <= bottom
  })
}

function aggregateGroups(
  rows: Array<{ key: string; hasText: boolean }>,
): Record<string, AppleVisionOcrEvidenceMetrics> {
  const groups = new Map<string, Array<{ hasText: boolean }>>()
  for (const row of rows) {
    const group = groups.get(row.key) ?? []
    group.push(row)
    groups.set(row.key, group)
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, group]) => [key, evidenceMetrics(group)]),
  )
}

export async function evaluateAppleVisionOcr(
  input: EvaluateAppleVisionOcrInput,
): Promise<AppleVisionOcrEvalReport> {
  const flat: Array<{ scenario: string; condition: string; hasText: boolean }> = []
  const samples: AppleVisionOcrEvalReport["samples"] = []
  for (const sample of input.manifest.samples) {
    const rows = appleVisionOcrRowsSchema.parse(await input.loadRows(sample.id))
    const annotations = sample.annotations.map((annotation) => {
      const matchedRows = rowsInsideAnnotation(rows, annotation.bbox)
      flat.push({
        scenario: sample.scenario ?? "unclassified",
        condition: annotation.recognitionCondition,
        hasText: matchedRows.length > 0,
      })
      return {
        id: annotation.id,
        productSku: annotation.productSku,
        recognitionCondition: annotation.recognitionCondition,
        texts: matchedRows.map((row) => row.text),
        maxConfidence: matchedRows.length > 0
          ? Math.max(...matchedRows.map((row) => row.confidence))
          : null,
      }
    })
    samples.push({
      id: sample.id,
      scenario: sample.scenario ?? null,
      metrics: evidenceMetrics(annotations.map((annotation) => ({ hasText: annotation.texts.length > 0 }))),
      annotations,
    })
  }

  return {
    version: 1,
    datasetId: input.manifest.datasetId,
    provider: "apple-vision-ocr",
    modelVersion: "VNRecognizeTextRequest-accurate",
    mode: "oracle-box-text-evidence",
    oracleLocalization: true,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    overallMetrics: evidenceMetrics(flat),
    scenarioMetrics: aggregateGroups(flat.map((row) => ({ key: row.scenario, hasText: row.hasText }))),
    conditionMetrics: aggregateGroups(flat.map((row) => ({ key: row.condition, hasText: row.hasText }))),
    samples,
  }
}
