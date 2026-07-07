// Guided Capture (docs/23 + docs/24 slice 1): сценарий шагов съемки.
// Photo-first: обязательные шаги — burst-фото, видео только если шаблон
// явно требует. Шаги приходят с сервера в task.captureTemplate (резолв по
// типу оборудования планограммы); без шаблона работает встроенный сценарий.

import type {
  MobileCaptureRetake,
  MobileCaptureTemplate,
  MobileCaptureTemplateStep,
} from "@leadshelf/api-contracts/mobile/v1"

export const GUIDED_SHELF_PROOF_SCENARIO_ID = "guided-shelf-proof-v1"

export type CaptureStepKind = "front" | "left_depth" | "right_depth" | "detail" | "top_down"
export type CaptureMediaKind = "photo" | "video"

export type CaptureStepTitleKey =
  | "proofStepFrontTitle"
  | "proofStepLeftDepthTitle"
  | "proofStepRightDepthTitle"
  | "proofStepDetailTitle"
  | "proofStepTopDownTitle"
  | "proofStepGenericTitle"

export type CaptureStepInstructionKey =
  | "proofStepFrontInstruction"
  | "proofStepLeftDepthInstruction"
  | "proofStepRightDepthInstruction"
  | "proofStepDetailInstruction"
  | "proofStepTopDownInstruction"
  | "proofStepGenericInstruction"

export interface CaptureScenarioStep {
  id: string
  kind: string
  titleKey: CaptureStepTitleKey
  instructionKey: CaptureStepInstructionKey
  /** Локализованный override из шаблона; UI: titleText ?? t(titleKey). */
  titleText?: string | null
  instructionText?: string | null
  required: boolean
  sequence: number
  mediaKind: CaptureMediaKind
  burstCount: number
  tiltToleranceDeg: number | null
  compositionHint: string | null
  doorPolicy: "open_allowed" | "open_forbidden" | null
  depthMode: string | null
  minDurationSeconds?: number
  maxDurationSeconds?: number
}

export interface CaptureScenario {
  scenarioId: string
  templateName: string | null
  steps: CaptureScenarioStep[]
}

export interface CaptureStepMetadata {
  scenarioId: string
  stepId: string
  stepKind: string
  required: boolean
  sequence: number
  mediaKind: CaptureMediaKind
  minDurationSeconds?: number
  maxDurationSeconds?: number
}

const STEP_TITLE_KEYS: Record<CaptureStepKind, CaptureStepTitleKey> = {
  front: "proofStepFrontTitle",
  left_depth: "proofStepLeftDepthTitle",
  right_depth: "proofStepRightDepthTitle",
  detail: "proofStepDetailTitle",
  top_down: "proofStepTopDownTitle",
}

const STEP_INSTRUCTION_KEYS: Record<CaptureStepKind, CaptureStepInstructionKey> = {
  front: "proofStepFrontInstruction",
  left_depth: "proofStepLeftDepthInstruction",
  right_depth: "proofStepRightDepthInstruction",
  detail: "proofStepDetailInstruction",
  top_down: "proofStepTopDownInstruction",
}

function titleKeyForKind(kind: string): CaptureStepTitleKey {
  return STEP_TITLE_KEYS[kind as CaptureStepKind] ?? "proofStepGenericTitle"
}

function instructionKeyForKind(kind: string): CaptureStepInstructionKey {
  return STEP_INSTRUCTION_KEYS[kind as CaptureStepKind] ?? "proofStepGenericInstruction"
}

export const DEFAULT_BURST_COUNT = 3

// Встроенный photo-first сценарий: работает без шаблона и офлайн всегда.
export const GUIDED_SHELF_PROOF_STEPS: CaptureScenarioStep[] = [
  {
    id: "front",
    kind: "front",
    titleKey: "proofStepFrontTitle",
    instructionKey: "proofStepFrontInstruction",
    required: true,
    sequence: 1,
    mediaKind: "photo",
    burstCount: DEFAULT_BURST_COUNT,
    tiltToleranceDeg: 6,
    compositionHint: null,
    doorPolicy: null,
    depthMode: null,
  },
  {
    id: "left-depth",
    kind: "left_depth",
    titleKey: "proofStepLeftDepthTitle",
    instructionKey: "proofStepLeftDepthInstruction",
    required: true,
    sequence: 2,
    mediaKind: "photo",
    burstCount: DEFAULT_BURST_COUNT,
    tiltToleranceDeg: null,
    compositionHint: "edge_left",
    doorPolicy: null,
    depthMode: "angle_photo",
  },
  {
    id: "right-depth",
    kind: "right_depth",
    titleKey: "proofStepRightDepthTitle",
    instructionKey: "proofStepRightDepthInstruction",
    required: true,
    sequence: 3,
    mediaKind: "photo",
    burstCount: DEFAULT_BURST_COUNT,
    tiltToleranceDeg: null,
    compositionHint: "edge_right",
    doorPolicy: null,
    depthMode: "angle_photo",
  },
  {
    id: "detail",
    kind: "detail",
    titleKey: "proofStepDetailTitle",
    instructionKey: "proofStepDetailInstruction",
    required: false,
    sequence: 4,
    mediaKind: "photo",
    burstCount: 1,
    tiltToleranceDeg: null,
    compositionHint: "close_up",
    doorPolicy: null,
    depthMode: null,
  },
]

function localizedOverride(
  overrides: Record<string, string> | null | undefined,
  locale: string,
): string | null {
  if (!overrides) return null
  return overrides[locale] ?? overrides.ru ?? overrides.az ?? null
}

function stepFromTemplate(
  step: MobileCaptureTemplateStep,
  locale: string,
): CaptureScenarioStep {
  return {
    id: step.id,
    kind: step.kind,
    titleKey: titleKeyForKind(step.kind),
    instructionKey: instructionKeyForKind(step.kind),
    titleText: localizedOverride(step.titleOverrides, locale),
    instructionText: localizedOverride(step.instructionOverrides, locale),
    required: step.required,
    sequence: step.sequence,
    mediaKind: step.mediaKind === "video" ? "video" : "photo",
    burstCount:
      step.mediaKind === "video" ? 1 : Math.max(1, step.burstCount ?? DEFAULT_BURST_COUNT),
    tiltToleranceDeg: step.tiltToleranceDeg ?? null,
    compositionHint: step.compositionHint ?? null,
    doorPolicy: step.doorPolicy ?? null,
    depthMode: step.depthMode ?? null,
    minDurationSeconds: step.minDurationSeconds ?? undefined,
    maxDurationSeconds: step.maxDurationSeconds ?? undefined,
  }
}

/**
 * Сценарий задачи: шаблон с сервера или встроенный fallback. Кривой/пустой
 * шаблон не должен блокировать поле — молча откатываемся на встроенный.
 */
export function resolveCaptureScenario(
  captureTemplate: MobileCaptureTemplate | null | undefined,
  locale: string,
): CaptureScenario {
  if (!captureTemplate || !Array.isArray(captureTemplate.steps) || captureTemplate.steps.length === 0) {
    return {
      scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
      templateName: null,
      steps: GUIDED_SHELF_PROOF_STEPS,
    }
  }
  const steps = captureTemplate.steps
    .filter((step) => typeof step?.id === "string" && step.id.length > 0)
    .map((step) => stepFromTemplate(step, locale))
    .sort((a, b) => a.sequence - b.sequence)
  if (steps.length === 0) {
    return {
      scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
      templateName: null,
      steps: GUIDED_SHELF_PROOF_STEPS,
    }
  }
  return {
    scenarioId: captureTemplate.scenarioId,
    templateName: captureTemplate.name ?? null,
    steps,
  }
}

export function toCaptureStepMetadata(
  step: CaptureScenarioStep,
  scenarioId: string = GUIDED_SHELF_PROOF_SCENARIO_ID,
): CaptureStepMetadata {
  return {
    scenarioId,
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
    stepKind,
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
      stepKind,
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

/** Обязательный сценарий закрыт: каждый required шаг снят или имеет исключение. */
export function isRequiredScenarioComplete(
  steps: CaptureScenarioStep[],
  completedStepIds: Set<string>,
  exceptionStepIds: Set<string> = new Set(),
  activeRetakeStepIds: Set<string> = new Set(),
): boolean {
  return steps
    .filter((step) => step.required)
    .every(
      (step) =>
        !activeRetakeStepIds.has(step.id) &&
        (completedStepIds.has(step.id) || exceptionStepIds.has(step.id)),
    )
}

/**
 * Активные запросы пересъемки: офис попросил переснять шаг и после этого
 * запроса еще нет свежего фото. Сравниваем requestedAt с временем последнего
 * локального фото шага, чтобы не показывать retake на только что переснятом
 * (сервер закроет запрос при следующей синхронизации).
 */
export function activeRetakeStepIds(
  retakes: MobileCaptureRetake[] | null | undefined,
  proofs: Array<{ takenAt: string; captureStepJson?: string | null; exifJson?: string | null }>,
): Set<string> {
  const active = new Set<string>()
  if (!retakes || retakes.length === 0) return active
  const latestProofByStep = new Map<string, string>()
  for (const proof of proofs) {
    const stepId = getCaptureStepFromProof(proof)?.stepId
    if (!stepId) continue
    const current = latestProofByStep.get(stepId)
    if (!current || proof.takenAt > current) latestProofByStep.set(stepId, proof.takenAt)
  }
  for (const retake of retakes) {
    const latestProof = latestProofByStep.get(retake.stepId)
    if (!latestProof || latestProof < retake.requestedAt) active.add(retake.stepId)
  }
  return active
}
