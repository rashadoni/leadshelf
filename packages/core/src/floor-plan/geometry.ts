export interface FloorPlanRoom {
  widthMm: number
  depthMm: number
}

export interface FloorPlanPlacementGeometry {
  xMm: number
  yMm: number
  widthMm: number
  depthMm: number
  rotationDeg: number
}

export interface FloorPlanPlacementIssue {
  type: "outside_bounds" | "collision"
  index: number
  conflictingIndex?: number
}

export function normalizeQuarterTurn(rotationDeg: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotationDeg / 90) * 90) % 360 + 360) % 360
  return normalized as 0 | 90 | 180 | 270
}

export function getRotatedFootprint(
  widthMm: number,
  depthMm: number,
  rotationDeg: number,
): { widthMm: number; depthMm: number } {
  const rotation = normalizeQuarterTurn(rotationDeg)
  return rotation === 90 || rotation === 270
    ? { widthMm: depthMm, depthMm: widthMm }
    : { widthMm, depthMm }
}

export function snapFloorPlanCoordinate(value: number, stepMm = 100): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value / stepMm) * stepMm)
}

export function isPlacementInsideRoom(room: FloorPlanRoom, placement: FloorPlanPlacementGeometry): boolean {
  const footprint = getRotatedFootprint(placement.widthMm, placement.depthMm, placement.rotationDeg)
  return (
    placement.xMm >= 0 &&
    placement.yMm >= 0 &&
    placement.xMm + footprint.widthMm <= room.widthMm &&
    placement.yMm + footprint.depthMm <= room.depthMm
  )
}

export function placementsOverlap(
  first: FloorPlanPlacementGeometry,
  second: FloorPlanPlacementGeometry,
): boolean {
  const firstSize = getRotatedFootprint(first.widthMm, first.depthMm, first.rotationDeg)
  const secondSize = getRotatedFootprint(second.widthMm, second.depthMm, second.rotationDeg)
  return (
    first.xMm < second.xMm + secondSize.widthMm &&
    first.xMm + firstSize.widthMm > second.xMm &&
    first.yMm < second.yMm + secondSize.depthMm &&
    first.yMm + firstSize.depthMm > second.yMm
  )
}

export function validateFloorPlanLayout(
  room: FloorPlanRoom,
  placements: FloorPlanPlacementGeometry[],
): FloorPlanPlacementIssue[] {
  const issues: FloorPlanPlacementIssue[] = []
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index]
    if (!placement) continue
    if (!isPlacementInsideRoom(room, placement)) {
      issues.push({ type: "outside_bounds", index })
    }
    for (let otherIndex = index + 1; otherIndex < placements.length; otherIndex += 1) {
      const otherPlacement = placements[otherIndex]
      if (otherPlacement && placementsOverlap(placement, otherPlacement)) {
        issues.push({ type: "collision", index, conflictingIndex: otherIndex })
      }
    }
  }
  return issues
}

export function findAvailableFloorPlanPosition(
  room: FloorPlanRoom,
  placement: Pick<FloorPlanPlacementGeometry, "widthMm" | "depthMm" | "rotationDeg">,
  existing: FloorPlanPlacementGeometry[],
  stepMm = 100,
): { xMm: number; yMm: number } | null {
  const footprint = getRotatedFootprint(placement.widthMm, placement.depthMm, placement.rotationDeg)
  for (let yMm = 0; yMm + footprint.depthMm <= room.depthMm; yMm += stepMm) {
    for (let xMm = 0; xMm + footprint.widthMm <= room.widthMm; xMm += stepMm) {
      const candidate = { ...placement, xMm, yMm }
      if (!existing.some((item) => placementsOverlap(candidate, item))) {
        return { xMm, yMm }
      }
    }
  }
  return null
}
