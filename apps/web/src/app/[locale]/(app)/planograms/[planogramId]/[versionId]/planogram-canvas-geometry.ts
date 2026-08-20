import {
  orientedProductSizeMm,
  type EquipmentShelfMm,
  type PlacementCandidateMm,
} from "@leadshelf/core"

export const PLANOGRAM_CANVAS_MAX_HEIGHT_PX = 900
export const PLANOGRAM_CANVAS_FALLBACK_WIDTH_PX = 560

export function planogramCanvasScale(input: {
  equipmentWidthMm: number
  equipmentHeightMm: number
  containerWidthPx: number
  zoom: number
}): number {
  const widthPx = input.containerWidthPx || PLANOGRAM_CANVAS_FALLBACK_WIDTH_PX
  const fitScale = Math.min(
    widthPx / input.equipmentWidthMm,
    PLANOGRAM_CANVAS_MAX_HEIGHT_PX / input.equipmentHeightMm,
  )
  return fitScale * input.zoom
}

export function placementCanvasGeometry(input: {
  equipmentHeightMm: number
  scale: number
  shelf: EquipmentShelfMm
  placement: PlacementCandidateMm
  xMm?: number
}) {
  const oriented = orientedProductSizeMm(input.placement)
  const faceWidthPx = oriented.widthMm * (input.placement.compressionX ?? 1) * input.scale
  const faceHeightPx = oriented.heightMm * (input.placement.compressionY ?? 1) * input.scale
  const faceGapPx = (input.placement.gapMm ?? 0) * input.scale
  const facingStepPx = faceWidthPx + faceGapPx

  return {
    xPx: (input.xMm ?? input.placement.xMm) * input.scale,
    yPx:
      input.equipmentHeightMm * input.scale
      - (input.shelf.yMm + input.shelf.thicknessMm) * input.scale
      - faceHeightPx * input.placement.facingsY,
    faceWidthPx,
    faceHeightPx,
    faceGapPx,
    facingStepPx,
    widthPx:
      faceWidthPx * input.placement.facingsX
      + faceGapPx * Math.max(0, input.placement.facingsX - 1),
    heightPx: faceHeightPx * input.placement.facingsY,
  }
}
