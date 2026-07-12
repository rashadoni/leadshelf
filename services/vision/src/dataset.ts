import { createHash } from "node:crypto"
import { z } from "zod"
import {
  validateVisionEvalManifest,
  visionEvalAnnotationSchema,
  type VisionEvalManifest,
  type VisionEvalSplit,
} from "./evaluation"

// Расширение приватного датасета (docs/planogram-comparison-roadmap Фаза 8).
// Логика чистая и тестируемая: CLI — тонкая обёртка. Фото и манифест живут
// вне Git; сюда попадают только правила, по которым датасет растёт без
// leakage и без ручного жонглирования сплитами.

export const datasetAnnotationsFileSchema = z.array(visionEvalAnnotationSchema).min(1)

export interface SplitRatios {
  calibration: number
  validation: number
  test: number
}

export const DEFAULT_SPLIT_RATIOS: SplitRatios = { calibration: 40, validation: 40, test: 20 }

export function parseSplitRatios(raw: string): SplitRatios {
  const parts = raw.split(",").map((part) => Number.parseInt(part.trim(), 10))
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`invalid_split_ratios:${raw}`)
  }
  const [calibration, validation, test] = parts as [number, number, number]
  if (calibration + validation + test !== 100) {
    throw new Error(`split_ratios_must_sum_to_100:${raw}`)
  }
  return { calibration, validation, test }
}

/**
 * Детерминированное назначение сплита по id сэмпла: один и тот же id всегда
 * попадает в один и тот же сплит независимо от порядка добавления. Уже
 * назначенные сэмплы НИКОГДА не переназначаются — миграция фото между
 * сплитами задним числом = leakage (test уже «видел» калибровку порогов).
 */
export function assignSplitDeterministically(
  sampleId: string,
  ratios: SplitRatios = DEFAULT_SPLIT_RATIOS,
): VisionEvalSplit {
  const digest = createHash("sha256").update(sampleId, "utf8").digest()
  const bucket = digest.readUInt32BE(0) % 100
  if (bucket < ratios.calibration) return "calibration"
  if (bucket < ratios.calibration + ratios.validation) return "validation"
  return "test"
}

export interface AddSampleInput {
  id: string
  photoRef: string
  goldenReferenceRef: string | null
  planogramVersionId: string
  scenario?: VisionEvalManifest["samples"][number]["scenario"]
  sourceKind: "real" | "synthetic"
  notes?: string
  split: VisionEvalSplit | "auto"
  ratios?: SplitRatios
  annotations: z.infer<typeof datasetAnnotationsFileSchema>
}

export interface AddSampleResult {
  manifest: VisionEvalManifest
  assignedSplit: VisionEvalSplit
}

export function addSampleToManifest(
  manifest: VisionEvalManifest,
  input: AddSampleInput,
): AddSampleResult {
  if (manifest.samples.some((sample) => sample.id === input.id)) {
    throw new Error(`sample_id_already_exists:${input.id}`)
  }
  if (manifest.samples.some((sample) => sample.photoRef === input.photoRef)) {
    throw new Error(`photo_ref_already_exists:${input.photoRef}`)
  }
  const assignedSplit =
    input.split === "auto" ? assignSplitDeterministically(input.id, input.ratios) : input.split
  const next: VisionEvalManifest = {
    ...manifest,
    samples: [
      ...manifest.samples,
      {
        id: input.id,
        split: assignedSplit,
        photoRef: input.photoRef,
        goldenReferenceRef: input.goldenReferenceRef,
        planogramVersionId: input.planogramVersionId,
        ...(input.scenario ? { scenario: input.scenario } : {}),
        sourceKind: input.sourceKind,
        ...(input.notes ? { notes: input.notes } : {}),
        annotations: input.annotations,
      },
    ],
  }
  const issues = validateVisionEvalManifest(next)
  if (issues.length > 0) {
    throw new Error(`manifest_invalid_after_add:${issues.join(",")}`)
  }
  return { manifest: next, assignedSplit }
}
