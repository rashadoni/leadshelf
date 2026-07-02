// Планограммная математика. Все размеры в миллиметрах (canonical unit,
// см. docs/04). Чистые функции без React/Prisma — это ядро пакета core.

export interface ProductSizeMm {
  widthMm: number
  heightMm: number
  depthMm: number
}

export interface ShelfSpaceMm {
  /** Полезная ширина полки. */
  innerWidthMm: number
  /** Глубина полки. */
  depthMm: number
  /** Просвет до следующей полки (или до верха оборудования). */
  clearanceHeightMm: number
}

/** Сколько фейсингов помещается по ширине с заданным зазором между ними. */
export function maxFacingsX(shelf: ShelfSpaceMm, product: ProductSizeMm, gapMm = 0): number {
  if (product.widthMm <= 0 || shelf.innerWidthMm <= 0) return 0
  return Math.max(0, Math.floor((shelf.innerWidthMm + gapMm) / (product.widthMm + gapMm)))
}

/** Сколько единиц помещается в глубину полки. */
export function maxFacingsZ(shelf: ShelfSpaceMm, product: ProductSizeMm): number {
  if (product.depthMm <= 0 || shelf.depthMm <= 0) return 0
  return Math.max(0, Math.floor(shelf.depthMm / product.depthMm))
}

/** Сколько единиц можно поставить друг на друга в просвете полки. */
export function maxFacingsY(shelf: ShelfSpaceMm, product: ProductSizeMm): number {
  if (product.heightMm <= 0 || shelf.clearanceHeightMm <= 0) return 0
  return Math.max(0, Math.floor(shelf.clearanceHeightMm / product.heightMm))
}

export interface CapacityResult {
  facingsX: number
  facingsY: number
  facingsZ: number
  totalUnits: number
  fits: boolean
}

/** Полная емкость полки под один товар (ответ на "сколько поместится"). */
export function shelfCapacity(shelf: ShelfSpaceMm, product: ProductSizeMm, gapMm = 0): CapacityResult {
  const facingsX = maxFacingsX(shelf, product, gapMm)
  const facingsY = maxFacingsY(shelf, product)
  const facingsZ = maxFacingsZ(shelf, product)
  const totalUnits = facingsX * facingsY * facingsZ
  return { facingsX, facingsY, facingsZ, totalUnits, fits: totalUnits > 0 }
}

export interface PlacementBoxMm {
  xMm: number
  widthMm: number
  facingsX: number
  gapMm?: number
}

/** Занятая ширина размещения по X, включая зазоры между фейсингами. */
export function placementWidthMm(p: PlacementBoxMm): number {
  const gap = p.gapMm ?? 0
  if (p.facingsX <= 0) return 0
  return p.facingsX * p.widthMm + (p.facingsX - 1) * gap
}

/** Пересекаются ли два размещения на одной полке по оси X. */
export function placementsOverlapX(a: PlacementBoxMm, b: PlacementBoxMm): boolean {
  const aEnd = a.xMm + placementWidthMm(a)
  const bEnd = b.xMm + placementWidthMm(b)
  return a.xMm < bEnd && b.xMm < aEnd
}
