// Планограммная математика. Все размеры в миллиметрах (canonical unit,
// см. docs/04). Чистые функции без React/Prisma — это ядро пакета core.

export interface ProductSizeMm {
  widthMm: number
  heightMm: number
  depthMm: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  compressionX?: number
  compressionY?: number
  compressionZ?: number
}

export type PlacementStackMode = "NONE" | "ON_TOP" | "LYING"

function quarterTurns(deg = 0): number {
  const normalized = ((deg % 360) + 360) % 360
  return Math.floor(normalized / 90) % 4
}

export function orientedProductSizeMm(product: ProductSizeMm): ProductSizeMm {
  let widthMm = product.widthMm
  let heightMm = product.heightMm
  let depthMm = product.depthMm

  if (quarterTurns(product.rotationX) % 2 === 1) {
    ;[heightMm, depthMm] = [depthMm, heightMm]
  }
  if (quarterTurns(product.rotationY) % 2 === 1) {
    ;[widthMm, depthMm] = [depthMm, widthMm]
  }
  if (quarterTurns(product.rotationZ) % 2 === 1) {
    ;[widthMm, heightMm] = [heightMm, widthMm]
  }

  return { ...product, widthMm, heightMm, depthMm }
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
  const oriented = orientedProductSizeMm(product)
  if (oriented.widthMm <= 0 || shelf.innerWidthMm <= 0) return 0
  return Math.max(0, Math.floor((shelf.innerWidthMm + gapMm) / (oriented.widthMm + gapMm)))
}

/** Сколько единиц помещается в глубину полки. */
export function maxFacingsZ(shelf: ShelfSpaceMm, product: ProductSizeMm): number {
  const oriented = orientedProductSizeMm(product)
  if (oriented.depthMm <= 0 || shelf.depthMm <= 0) return 0
  return Math.max(0, Math.floor(shelf.depthMm / oriented.depthMm))
}

/** Сколько единиц можно поставить друг на друга в просвете полки. */
export function maxFacingsY(shelf: ShelfSpaceMm, product: ProductSizeMm): number {
  const oriented = orientedProductSizeMm(product)
  if (oriented.heightMm <= 0 || shelf.clearanceHeightMm <= 0) return 0
  return Math.max(0, Math.floor(shelf.clearanceHeightMm / oriented.heightMm))
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
  heightMm?: number
  depthMm?: number
  facingsX: number
  gapMm?: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  compressionX?: number
}

/** Занятая ширина размещения по X, включая зазоры между фейсингами. */
export function placementWidthMm(p: PlacementBoxMm): number {
  const gap = p.gapMm ?? 0
  if (p.facingsX <= 0) return 0
  const widthMm =
    p.heightMm == null || p.depthMm == null ? p.widthMm : orientedProductSizeMm(p as ProductSizeMm).widthMm
  const compressionX = p.compressionX ?? 1
  return p.facingsX * widthMm * compressionX + (p.facingsX - 1) * gap
}

/** Пересекаются ли два размещения на одной полке по оси X. */
export function placementsOverlapX(a: PlacementBoxMm, b: PlacementBoxMm): boolean {
  const aEnd = a.xMm + placementWidthMm(a)
  const bEnd = b.xMm + placementWidthMm(b)
  return a.xMm < bEnd && b.xMm < aEnd
}
