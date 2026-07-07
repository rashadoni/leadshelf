// Гид уровня 1 (docs/24): чистая математика для пузырькового уровня и
// силуэта оборудования. Никаких импортов expo/* — тестируется в CI.

export interface TiltSample {
  x: number
  y: number
  z: number
}

export interface TiltState {
  /** Отклонение в плоскости экрана (портрет), градусы; >0 — вправо. */
  rollDeg: number
  /** Наклон вперед/назад от вертикали, градусы (знак платформозависим). */
  pitchDeg: number
}

const RAD_TO_DEG = 180 / Math.PI

/**
 * Наклон телефона из вектора акселерометра (g-force, гравитация внутри).
 * Знак y/z у iOS и Android отличается, поэтому roll считаем от |y|, а гейт
 * делаем по модулям углов — направление стрелок не обещаем на уровне 1.
 */
export function computeTilt(sample: TiltSample): TiltState {
  const { x, y, z } = sample
  const rollDeg = Math.atan2(x, Math.abs(y)) * RAD_TO_DEG
  const pitchDeg = Math.atan2(z, Math.hypot(x, y)) * RAD_TO_DEG
  return { rollDeg, pitchDeg }
}

export interface TiltEvaluation {
  level: boolean
  offAxisDeg: number
}

export function evaluateTilt(state: TiltState, toleranceDeg: number): TiltEvaluation {
  const offAxisDeg = Math.max(Math.abs(state.rollDeg), Math.abs(state.pitchDeg))
  return { level: offAxisDeg <= toleranceDeg, offAxisDeg }
}

export interface EquipmentGeometry {
  widthMm: number
  heightMm: number
  shelves?: Array<{ yMm: number }>
}

export interface EquipmentSilhouette {
  /** width / height реального оборудования. */
  aspect: number
  /** Позиции полок как доли высоты от ВЕРХА силуэта (0..1). */
  shelfFractions: number[]
}

/**
 * Силуэт для видоискателя из мм-модели оборудования (уже есть в planogram
 * bundle офлайн). Возвращает null, если геометрия неполная — UI рисует
 * generic-рамку.
 */
export function buildEquipmentSilhouette(
  equipment: EquipmentGeometry | null | undefined,
): EquipmentSilhouette | null {
  if (!equipment) return null
  const { widthMm, heightMm } = equipment
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return null
  }
  const shelfFractions = (equipment.shelves ?? [])
    .map((shelf) => 1 - shelf.yMm / heightMm)
    .filter((fraction) => fraction > 0 && fraction < 1)
    .sort((a, b) => a - b)
  return { aspect: widthMm / heightMm, shelfFractions }
}

export interface CaptureStepTelemetry {
  stepId: string
  openedAt: number
  acceptedAt: number | null
  retakes: number
  manualOverride: boolean
  gyroAvailable: boolean
  issues: string[]
}

export function buildTelemetryPayload(telemetry: CaptureStepTelemetry): Record<string, unknown> {
  return {
    stepId: telemetry.stepId,
    timeToAcceptedMs:
      telemetry.acceptedAt != null ? Math.max(0, telemetry.acceptedAt - telemetry.openedAt) : null,
    retakes: telemetry.retakes,
    manualOverride: telemetry.manualOverride,
    gyroAvailable: telemetry.gyroAvailable,
    issues: telemetry.issues,
  }
}
