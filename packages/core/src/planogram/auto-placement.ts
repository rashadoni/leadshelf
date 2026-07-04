import { placementWidthMm } from "./capacity"
import {
  shelfSpaceForShelf,
  validatePlacementOnShelf,
  type EquipmentGeometryMm,
  type PlacementCandidateMm,
} from "./placement"

export interface AutoPlacementZoneMm {
  id: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

export interface AutoPlacementProductMm {
  id: string
  widthMm: number
  heightMm: number
  depthMm: number
  score: number
  isSoftPack?: boolean
  minCompressionX?: number
}

export interface AutoPlacementPlan {
  productId: string
  shelfId: string
  xMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
  compressionX: number
  score: number
  reason: string
}

export interface AutoPlacementReject {
  productId: string
  reason: string
}

function nextFreeInRange(input: {
  shelfId: string
  widthNeededMm: number
  startMm: number
  endMm: number
  existing: PlacementCandidateMm[]
}): number | null {
  const intervals = input.existing
    .filter((placement) => placement.shelfId === input.shelfId)
    .map((placement) => ({
      start: placement.xMm,
      end: placement.xMm + placementWidthMm(placement),
    }))
    .sort((a, b) => a.start - b.start)

  let cursor = input.startMm
  for (const interval of intervals) {
    if (interval.end <= input.startMm) continue
    if (interval.start >= input.endMm) break
    if (interval.start - cursor >= input.widthNeededMm) return cursor
    cursor = Math.max(cursor, interval.end)
  }
  return input.endMm - cursor >= input.widthNeededMm ? cursor : null
}

function facingsForScore(score: number, maxScore: number): number {
  if (maxScore <= 0) return 1
  const ratio = score / maxScore
  if (ratio >= 0.66) return 3
  if (ratio >= 0.33) return 2
  return 1
}

function compressionSteps(product: AutoPlacementProductMm): number[] {
  if (!product.isSoftPack) return [1]
  const min = Math.max(0.75, Math.min(product.minCompressionX ?? 0.85, 1))
  return [1, 0.95, 0.9, 0.85, 0.8, 0.75].filter((value) => value >= min)
}

export function planAutoPlacementInZone(input: {
  equipment: EquipmentGeometryMm
  zone: AutoPlacementZoneMm
  products: AutoPlacementProductMm[]
  existing: PlacementCandidateMm[]
  maxProducts?: number
}): { placements: AutoPlacementPlan[]; rejected: AutoPlacementReject[] } {
  const zoneEnd = input.zone.xMm + input.zone.widthMm
  const maxScore = Math.max(0, ...input.products.map((product) => product.score))
  const existing = [...input.existing]
  const placements: AutoPlacementPlan[] = []
  const rejected: AutoPlacementReject[] = []
  const shelfIds = input.equipment.shelves
    .filter((shelf) => {
      const space = shelfSpaceForShelf(input.equipment, shelf.id)
      if (!space) return false
      return space.surfaceYMm >= input.zone.yMm && space.surfaceYMm <= input.zone.yMm + input.zone.heightMm
    })
    .sort((a, b) => b.yMm - a.yMm)
    .map((shelf) => shelf.id)

  for (const product of input.products.slice(0, input.maxProducts ?? input.products.length)) {
    let placed: AutoPlacementPlan | null = null
    const preferredFacings = facingsForScore(product.score, maxScore)
    for (const shelfId of shelfIds) {
      const shelf = shelfSpaceForShelf(input.equipment, shelfId)
      if (!shelf) continue
      for (let facingsX = preferredFacings; facingsX >= 1; facingsX--) {
        for (const compressionX of compressionSteps(product)) {
          const widthNeededMm = product.widthMm * compressionX * facingsX
          const xMm = nextFreeInRange({
            shelfId,
            widthNeededMm,
            startMm: input.zone.xMm,
            endMm: Math.min(zoneEnd, shelf.innerWidthMm),
            existing,
          })
          if (xMm == null) continue
          const candidate: PlacementCandidateMm = {
            shelfId,
            xMm,
            widthMm: product.widthMm,
            heightMm: product.heightMm,
            depthMm: product.depthMm,
            compressionX,
            facingsX,
            facingsY: 1,
            facingsZ: 1,
          }
          const verdict = validatePlacementOnShelf({ shelf, candidate, existing })
          if (!verdict.ok) continue
          placed = {
            productId: product.id,
            shelfId,
            xMm,
            facingsX,
            facingsY: 1,
            facingsZ: 1,
            compressionX,
            score: product.score,
            reason: `score=${product.score}; facingsX=${facingsX}; compressionX=${compressionX}; zone=${input.zone.id}`,
          }
          existing.push({ ...candidate, id: `planned:${product.id}` })
          break
        }
        if (placed) break
      }
      if (placed) break
    }
    if (placed) placements.push(placed)
    else rejected.push({ productId: product.id, reason: "no free physical slot inside zone" })
  }

  return { placements, rejected }
}
