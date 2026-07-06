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
}

export interface CaptureStepMetadata {
  scenarioId: string
  stepId: string
  stepKind: CaptureStepKind
  required: boolean
  sequence: number
  mediaKind: CaptureMediaKind
}

export const GUIDED_SHELF_PROOF_STEPS: CaptureScenarioStep[] = [
  {
    id: "front",
    kind: "front",
    titleKey: "proofStepFrontTitle",
    instructionKey: "proofStepFrontInstruction",
    required: true,
    sequence: 1,
    mediaKind: "photo",
  },
  {
    id: "left-depth",
    kind: "left_depth",
    titleKey: "proofStepLeftDepthTitle",
    instructionKey: "proofStepLeftDepthInstruction",
    required: true,
    sequence: 2,
    mediaKind: "photo",
  },
  {
    id: "right-depth",
    kind: "right_depth",
    titleKey: "proofStepRightDepthTitle",
    instructionKey: "proofStepRightDepthInstruction",
    required: true,
    sequence: 3,
    mediaKind: "photo",
  },
  {
    id: "detail",
    kind: "detail",
    titleKey: "proofStepDetailTitle",
    instructionKey: "proofStepDetailInstruction",
    required: false,
    sequence: 4,
    mediaKind: "photo",
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
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
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
    const stepId = typeof captureStep.id === "string" ? captureStep.id : null
    const stepKind = typeof captureStep.kind === "string" ? captureStep.kind : null
    if (!stepId || !stepKind) return null
    return {
      scenarioId:
        (typeof captureScenario.id === "string" ? captureScenario.id : null) ??
        GUIDED_SHELF_PROOF_SCENARIO_ID,
      stepId,
      stepKind: stepKind as CaptureStepKind,
      required: typeof captureStep.required === "boolean" ? captureStep.required : false,
      sequence: typeof captureStep.sequence === "number" ? captureStep.sequence : 0,
      mediaKind: captureStep.mediaKind === "video" ? "video" : "photo",
    }
  } catch {
    return null
  }
}

export function getCompletedCaptureStepIds(
  proofs: Array<{ exifJson?: string | null }>,
): Set<string> {
  return new Set(
    proofs
      .map((proof) => extractCaptureStepFromExifJson(proof.exifJson)?.stepId ?? null)
      .filter((stepId): stepId is string => !!stepId),
  )
}

export function getNextRequiredCaptureStep(
  completedStepIds: Set<string>,
  steps: CaptureScenarioStep[] = GUIDED_SHELF_PROOF_STEPS,
): CaptureScenarioStep | null {
  return steps.find((step) => step.required && !completedStepIds.has(step.id)) ?? null
}
