// Физика размещения товара на полке — «валидация как физика» (Tier-1 UX,
// docs/10): невлезающий товар не встает, причина отказа — физическая,
// в миллиметрах. Все проверки чистые, без Prisma/React.

import {
  orientedProductSizeMm,
  placementWidthMm,
  shelfCapacity,
  type CapacityResult,
  type PlacementStackMode,
  type ProductSizeMm,
  type ShelfSpaceMm,
} from "./capacity"

export interface EquipmentShelfMm {
  id: string
  shelfIndex: number
  yMm: number
  thicknessMm: number
  depthMm: number
}

export interface EquipmentGeometryMm {
  widthMm: number
  heightMm: number
  depthMm: number
  shelves: EquipmentShelfMm[]
}

/** Пространство конкретной полки; просвет считается ДО ПОЛКИ ВЫШЕ, не до верха. */
export function shelfSpaceForShelf(
  equipment: EquipmentGeometryMm,
  shelfId: string,
): (ShelfSpaceMm & { shelfId: string; yMm: number; surfaceYMm: number }) | null {
  const shelf = equipment.shelves.find((s) => s.id === shelfId)
  if (!shelf) return null
  const above = equipment.shelves
    .filter((s) => s.yMm > shelf.yMm)
    .sort((a, b) => a.yMm - b.yMm)[0]
  const ceiling = above ? above.yMm : equipment.heightMm
  const surfaceYMm = shelf.yMm + shelf.thicknessMm
  return {
    shelfId,
    yMm: shelf.yMm,
    surfaceYMm,
    innerWidthMm: equipment.widthMm,
    depthMm: shelf.depthMm,
    clearanceHeightMm: ceiling - surfaceYMm,
  }
}

export interface PlacementCandidateMm extends ProductSizeMm {
  id?: string
  shelfId: string
  xMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  stackMode?: PlacementStackMode
  gapMm?: number
}

export type PlacementIssueCode =
  | "invalid_facings"
  | "outside_width"
  | "outside_depth"
  | "outside_height"
  | "collision"

export type PlacementValidation =
  | { ok: true; occupiedWidthMm: number; capacity: CapacityResult }
  | { ok: false; code: PlacementIssueCode; message: string }

/** Занятые интервалы по X на полке (для коллизий и поиска свободного места). */
function intervalsOnShelf(
  existing: PlacementCandidateMm[],
  shelfId: string,
  ignoreId?: string,
): Array<{ start: number; end: number; id?: string }> {
  return existing
    .filter((p) => p.shelfId === shelfId && (ignoreId == null || p.id !== ignoreId))
    .map((p) => ({ id: p.id, start: p.xMm, end: p.xMm + placementWidthMm(p) }))
    .sort((a, b) => a.start - b.start)
}

export function validatePlacementOnShelf(input: {
  shelf: ShelfSpaceMm
  candidate: PlacementCandidateMm
  existing: PlacementCandidateMm[]
  ignorePlacementId?: string
}): PlacementValidation {
  const { shelf, candidate, existing } = input
  const ignoreId = input.ignorePlacementId ?? candidate.id

  for (const f of ["facingsX", "facingsY", "facingsZ"] as const) {
    if (!Number.isInteger(candidate[f]) || candidate[f] < 1) {
      return { ok: false, code: "invalid_facings", message: `${f} должен быть >= 1` }
    }
  }

  const width = placementWidthMm(candidate)
  if (candidate.xMm < 0 || candidate.xMm + width > shelf.innerWidthMm) {
    return {
      ok: false,
      code: "outside_width",
      message: `ширина ${width}мм на позиции ${candidate.xMm}мм выходит за полку ${shelf.innerWidthMm}мм`,
    }
  }

  const oriented = orientedProductSizeMm(candidate)
  const depth = oriented.depthMm * candidate.facingsZ
  const compressedDepth = depth * (candidate.compressionZ ?? 1)
  if (compressedDepth > shelf.depthMm) {
    return {
      ok: false,
      code: "outside_depth",
      message: `глубина ${compressedDepth}мм > полки ${shelf.depthMm}мм`,
    }
  }

  const height = oriented.heightMm * candidate.facingsY
  const compressedHeight = height * (candidate.compressionY ?? 1)
  if (compressedHeight > shelf.clearanceHeightMm) {
    return {
      ok: false,
      code: "outside_height",
      message: `высота ${compressedHeight}мм > просвета до следующей полки ${shelf.clearanceHeightMm}мм`,
    }
  }

  const candidateEnd = candidate.xMm + width
  for (const iv of intervalsOnShelf(existing, candidate.shelfId, ignoreId)) {
    if (candidate.xMm < iv.end && iv.start < candidateEnd) {
      return {
        ok: false,
        code: "collision",
        message: `пересекается с размещением на ${iv.start}-${iv.end}мм`,
      }
    }
  }

  return { ok: true, occupiedWidthMm: width, capacity: shelfCapacity(shelf, candidate) }
}

/** Первая свободная позиция по X под нужную ширину; null — не помещается. */
export function nextFreeXMm(input: {
  shelf: ShelfSpaceMm
  widthNeededMm: number
  existing: PlacementCandidateMm[]
  shelfId: string
}): number | null {
  const intervals = intervalsOnShelf(input.existing, input.shelfId)
  let cursor = 0
  for (const iv of intervals) {
    if (iv.start - cursor >= input.widthNeededMm) return cursor
    cursor = Math.max(cursor, iv.end)
  }
  return input.shelf.innerWidthMm - cursor >= input.widthNeededMm ? cursor : null
}

/** Сводка занятости полки для индикатора емкости. */
export function shelfUsage(input: {
  shelf: ShelfSpaceMm
  existing: PlacementCandidateMm[]
  shelfId: string
}): { usedWidthMm: number; freeWidthMm: number } {
  const used = intervalsOnShelf(input.existing, input.shelfId).reduce(
    (acc, iv) => acc + (iv.end - iv.start),
    0,
  )
  return { usedWidthMm: used, freeWidthMm: Math.max(0, input.shelf.innerWidthMm - used) }
}
