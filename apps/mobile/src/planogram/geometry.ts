export interface PlacementWidthInput {
  widthMm: number
  heightMm?: number | null
  depthMm?: number | null
  facingsX: number
  rotationX?: number | null
  rotationY?: number | null
  rotationZ?: number | null
  compressionX?: number | null
}

function quarterTurns(deg = 0): number {
  const normalized = ((deg % 360) + 360) % 360
  return Math.floor(normalized / 90) % 4
}

export function placementEffectiveSizeMm(placement: PlacementWidthInput): { widthMm: number; heightMm: number | null; depthMm: number | null } {
  let widthMm = placement.widthMm
  let heightMm = placement.heightMm ?? null
  let depthMm = placement.depthMm ?? null

  if (heightMm != null && depthMm != null && quarterTurns(placement.rotationX ?? 0) % 2 === 1) {
    ;[heightMm, depthMm] = [depthMm, heightMm]
  }
  if (depthMm != null && quarterTurns(placement.rotationY ?? 0) % 2 === 1) {
    ;[widthMm, depthMm] = [depthMm, widthMm]
  }
  if (heightMm != null && quarterTurns(placement.rotationZ ?? 0) % 2 === 1) {
    ;[widthMm, heightMm] = [heightMm, widthMm]
  }

  return { widthMm, heightMm, depthMm }
}

export function placementFaceWidthMm(placement: PlacementWidthInput): number {
  return placementEffectiveSizeMm(placement).widthMm * (placement.compressionX ?? 1)
}

export function placementDisplayWidthMm(placement: PlacementWidthInput): number {
  return placementFaceWidthMm(placement) * placement.facingsX
}
