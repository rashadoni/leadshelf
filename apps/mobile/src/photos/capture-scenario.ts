export const GUIDED_SHELF_PROOF_SCENARIO_ID = "guided-shelf-proof-v1"

export type CaptureStepKind = "front" | "left_depth" | "right_depth" | "detail"
export type CaptureMediaKind = "photo" | "video"

export interface CaptureScenarioStep {
  id: string
  kind: CaptureStepKind
  titleKey:
    | "proofStepFrontTitle"
    | "proofStepLeftDepthTitle"
    | "proofStepRightDepthTitle"
    | "proofStepDetailTitle"
  instructionKey:
    | "proofStepFrontInstruction"
    | "proofStepLeftDepthInstruction"
    | "proofStepRightDepthInstruction"
    | "proofStepDetailInstruction"
  required: boolean
  sequence: number
  mediaKind: CaptureMediaKind
  minDurationSeconds?: number
  maxDurationSeconds?: number
}

export interface CaptureStepMetadata {
  scenarioId: string
  stepId: string
  stepKind: CaptureStepKind
  required: boolean
  sequence: number
  mediaKind: CaptureMediaKind
  minDurationSeconds?: number
  maxDurationSeconds?: number
}

export const GUIDED_SHELF_PROOF_STEPS: CaptureScenarioStep[] = [
  {
    id: "front",
    kind: "front",
    titleKey: "proofStepFrontTitle",
    instructionKey: "proofStepFrontInstruction",
    required: true,
    sequence: 1,
    mediaKind: "video",
    minDurationSeconds: 5,
    maxDurationSeconds: 8,
  },
  {
    id: "left-depth",
    kind: "left_depth",
    titleKey: "proofStepLeftDepthTitle",
    instructionKey: "proofStepLeftDepthInstruction",
    required: true,
    sequence: 2,
    mediaKind: "video",
    minDurationSeconds: 3,
    maxDurationSeconds: 6,
  },
  {
    id: "right-depth",
    kind: "right_depth",
    titleKey: "proofStepRightDepthTitle",
    instructionKey: "proofStepRightDepthInstruction",
    required: true,
    sequence: 3,
    mediaKind: "video",
    minDurationSeconds: 3,
    maxDurationSeconds: 6,
  },
  {
    id: "detail",
    kind: "detail",
    titleKey: "proofStepDetailTitle",
    instructionKey: "proofStepDetailInstruction",
    required: false,
    sequence: 4,
    mediaKind: "photo",
    minDurationSeconds: 0,
    maxDurationSeconds: 0,
  },
]

export function toCaptureStepMetadata(step: CaptureScenarioStep): CaptureStepMetadata {
  return {
    scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
    stepId: step.id,
    stepKind: step.kind,
    required: step.required,
    sequence: step.sequence,
    mediaKind: step.mediaKind,
    minDurationSeconds: step.minDurationSeconds,
    maxDurationSeconds: step.maxDurationSeconds,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function captureStepFromRecord(
  captureStep: Record<string, unknown>,
  scenarioId: string = GUIDED_SHELF_PROOF_SCENARIO_ID,
): CaptureStepMetadata | null {
  const stepId = typeof captureStep.id === "string" ? captureStep.id : null
  const stepKind = typeof captureStep.kind === "string" ? captureStep.kind : null
  if (!stepId || !stepKind) return null
  return {
    scenarioId,
    stepId,
    stepKind: stepKind as CaptureStepKind,
    required: typeof captureStep.required === "boolean" ? captureStep.required : false,
    sequence: typeof captureStep.sequence === "number" ? captureStep.sequence : 0,
    mediaKind: captureStep.mediaKind === "video" ? "video" : "photo",
    minDurationSeconds:
      typeof captureStep.minDurationSeconds === "number" ? captureStep.minDurationSeconds : undefined,
    maxDurationSeconds:
      typeof captureStep.maxDurationSeconds === "number" ? captureStep.maxDurationSeconds : undefined,
  }
}

export function parseCaptureStepMetadataJson(captureStepJson?: string | null): CaptureStepMetadata | null {
  if (!captureStepJson) return null
  try {
    const parsed = asRecord(JSON.parse(captureStepJson))
    const stepId = typeof parsed.stepId === "string" ? parsed.stepId : null
    const stepKind = typeof parsed.stepKind === "string" ? parsed.stepKind : null
    if (!stepId || !stepKind) return null
    return {
      scenarioId:
        (typeof parsed.scenarioId === "string" ? parsed.scenarioId : null) ??
        GUIDED_SHELF_PROOF_SCENARIO_ID,
      stepId,
      stepKind: stepKind as CaptureStepKind,
      required: typeof parsed.required === "boolean" ? parsed.required : false,
      sequence: typeof parsed.sequence === "number" ? parsed.sequence : 0,
      mediaKind: parsed.mediaKind === "video" ? "video" : "photo",
      minDurationSeconds:
        typeof parsed.minDurationSeconds === "number" ? parsed.minDurationSeconds : undefined,
      maxDurationSeconds:
        typeof parsed.maxDurationSeconds === "number" ? parsed.maxDurationSeconds : undefined,
    }
  } catch {
    return null
  }
}

export function extractCaptureStepFromExifJson(exifJson?: string | null): CaptureStepMetadata | null {
  if (!exifJson) return null
  try {
    const exif = asRecord(JSON.parse(exifJson))
    const descriptionRaw = exif.ImageDescription ?? exif.imageDescription
    const description =
      typeof descriptionRaw === "string" ? asRecord(JSON.parse(descriptionRaw)) : asRecord(descriptionRaw)
    const captureStep = asRecord(description.captureStep)
    const captureScenario = asRecord(description.captureScenario)
    return captureStepFromRecord(
      captureStep,
      (typeof captureScenario.id === "string" ? captureScenario.id : null) ??
        GUIDED_SHELF_PROOF_SCENARIO_ID,
    )
  } catch {
    return null
  }
}

export function getCaptureStepFromProof(proof: {
  captureStepJson?: string | null
  exifJson?: string | null
}): CaptureStepMetadata | null {
  return parseCaptureStepMetadataJson(proof.captureStepJson) ?? extractCaptureStepFromExifJson(proof.exifJson)
}

export function getCompletedCaptureStepIds(
  proofs: Array<{ captureStepJson?: string | null; exifJson?: string | null }>,
): Set<string> {
  return new Set(
    proofs
      .map((proof) => getCaptureStepFromProof(proof)?.stepId ?? null)
      .filter((stepId): stepId is string => !!stepId),
  )
}

export function getNextRequiredCaptureStep(
  completedStepIds: Set<string>,
  steps: CaptureScenarioStep[] = GUIDED_SHELF_PROOF_STEPS,
): CaptureScenarioStep | null {
  return steps.find((step) => step.required && !completedStepIds.has(step.id)) ?? null
}
