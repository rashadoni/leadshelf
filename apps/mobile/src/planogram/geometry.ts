export interface PlacementWidthInput {
  widthMm: number
  facingsX: number
  compressionX?: number | null
}

export function placementFaceWidthMm(placement: PlacementWidthInput): number {
  return placement.widthMm * (placement.compressionX ?? 1)
}

export function placementDisplayWidthMm(placement: PlacementWidthInput): number {
  return placementFaceWidthMm(placement) * placement.facingsX
}
