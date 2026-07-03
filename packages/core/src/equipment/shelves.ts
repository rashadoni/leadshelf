// Авто-раскладка полок (shelf fill tool из Leafio-демо, docs/06 п.1).
// Все размеры в мм, полки снизу вверх (shelfIndex 0 = нижняя),
// yMm = нижняя кромка полки от пола оборудования.

export interface ShelfAutoLayoutInput {
  equipmentHeightMm: number
  equipmentDepthMm: number
  shelfCount: number
  shelfThicknessMm: number
  shelfDepthMm: number
  topOffsetMm: number
  bottomOffsetMm: number
  /** Минимальный просвет между полками; бизнес-минимум по умолчанию 50мм. */
  minClearanceMm?: number
}

export interface ShelfGeometryDraft {
  shelfIndex: number
  yMm: number
  thicknessMm: number
  depthMm: number
}

export interface ShelfLayoutResult {
  shelves: ShelfGeometryDraft[]
  rowGapMm: number
  /** Просвет над каждой полкой (до следующей или до верха с учетом topOffset). */
  clearancesMm: number[]
}

export interface ShelfValidationIssue {
  code:
    | "invalid_dimension"
    | "shelf_count_required"
    | "shelves_do_not_fit"
    | "clearance_too_small"
    | "shelf_depth_exceeds_equipment"
  message: string
  field?: keyof ShelfAutoLayoutInput
}

const DEFAULT_MIN_CLEARANCE = 50

export function validateShelfAutoLayout(input: ShelfAutoLayoutInput): ShelfValidationIssue[] {
  const issues: ShelfValidationIssue[] = []
  const minClearance = input.minClearanceMm ?? DEFAULT_MIN_CLEARANCE

  for (const field of [
    "equipmentHeightMm",
    "equipmentDepthMm",
    "shelfThicknessMm",
    "shelfDepthMm",
  ] as const) {
    if (!Number.isInteger(input[field]) || input[field] <= 0) {
      issues.push({ code: "invalid_dimension", message: `${field} must be a positive integer`, field })
    }
  }
  for (const field of ["topOffsetMm", "bottomOffsetMm"] as const) {
    if (!Number.isInteger(input[field]) || input[field] < 0) {
      issues.push({ code: "invalid_dimension", message: `${field} must be a non-negative integer`, field })
    }
  }
  if (!Number.isInteger(input.shelfCount) || input.shelfCount < 1) {
    issues.push({
      code: "shelf_count_required",
      message: "at least one shelf required",
      field: "shelfCount",
    })
  }
  if (issues.length > 0) return issues

  if (input.shelfDepthMm > input.equipmentDepthMm) {
    issues.push({
      code: "shelf_depth_exceeds_equipment",
      message: "shelf depth exceeds equipment depth",
      field: "shelfDepthMm",
    })
  }

  const available =
    input.equipmentHeightMm -
    input.topOffsetMm -
    input.bottomOffsetMm -
    input.shelfCount * input.shelfThicknessMm
  if (available < 0) {
    issues.push({
      code: "shelves_do_not_fit",
      message: "shelves with offsets exceed equipment height",
      field: "shelfCount",
    })
    return issues
  }

  // просветов = shelfCount (над каждой полкой, верхний — до верха)
  const clearance = available / input.shelfCount
  if (clearance < minClearance) {
    issues.push({
      code: "clearance_too_small",
      message: `clearance ${Math.floor(clearance)}mm is below minimum ${minClearance}mm`,
      field: "shelfCount",
    })
  }
  return issues
}

/** Серверная проверка ЯВНОГО списка полок против геометрии оборудования. */
export function validateShelfList(
  shelves: ShelfGeometryDraft[],
  geometry: { heightMm: number; depthMm: number },
): ShelfValidationIssue[] {
  const issues: ShelfValidationIssue[] = []
  const seen = new Set<number>()
  for (const s of shelves) {
    if (seen.has(s.shelfIndex)) {
      issues.push({ code: "invalid_dimension", message: `duplicate shelfIndex ${s.shelfIndex}` })
    }
    seen.add(s.shelfIndex)
    if (s.yMm < 0 || s.thicknessMm <= 0 || s.depthMm <= 0) {
      issues.push({ code: "invalid_dimension", message: `shelf ${s.shelfIndex}: bad geometry` })
    }
    if (s.yMm + s.thicknessMm > geometry.heightMm) {
      issues.push({
        code: "shelves_do_not_fit",
        message: `shelf ${s.shelfIndex} exceeds equipment height`,
      })
    }
    if (s.depthMm > geometry.depthMm) {
      issues.push({
        code: "shelf_depth_exceeds_equipment",
        message: `shelf ${s.shelfIndex} deeper than equipment`,
      })
    }
  }
  return issues
}

/**
 * Равномерная раскладка: просветы над каждой полкой одинаковы (включая
 * просвет верхней полки до верха за вычетом topOffset). Округление вниз до
 * целых мм; остаток уходит в верхний просвет.
 */
export function layoutEqualShelves(input: ShelfAutoLayoutInput): ShelfLayoutResult {
  const issues = validateShelfAutoLayout(input)
  if (issues.length > 0) {
    throw new Error(`invalid shelf layout: ${issues.map((i) => i.code).join(", ")}`)
  }

  const available =
    input.equipmentHeightMm -
    input.topOffsetMm -
    input.bottomOffsetMm -
    input.shelfCount * input.shelfThicknessMm
  const gap = Math.floor(available / input.shelfCount)

  const shelves: ShelfGeometryDraft[] = []
  const clearancesMm: number[] = []
  let y = input.bottomOffsetMm
  for (let i = 0; i < input.shelfCount; i++) {
    shelves.push({
      shelfIndex: i,
      yMm: y,
      thicknessMm: input.shelfThicknessMm,
      depthMm: input.shelfDepthMm,
    })
    const isTop = i === input.shelfCount - 1
    const clearance = isTop
      ? input.equipmentHeightMm - input.topOffsetMm - (y + input.shelfThicknessMm)
      : gap
    clearancesMm.push(clearance)
    y += input.shelfThicknessMm + gap
  }

  return { shelves, rowGapMm: gap, clearancesMm }
}
