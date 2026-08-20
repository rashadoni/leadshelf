import {
  orientedProductSizeMm,
  type EquipmentGeometryMm,
  type PlacementStackMode,
} from "@leadshelf/core"

export type ThreeViewerPlacement = {
  id: string
  shelfId: string
  xMm: number
  widthMm: number
  heightMm: number
  depthMm: number
  facingsX: number
  facingsY: number
  facingsZ: number
  compressionX?: number
  compressionY?: number
  compressionZ?: number
  gapMm?: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  stackMode?: PlacementStackMode
  product: { sku: string; name: string }
}

export type SceneVector = {
  x: number
  y: number
  z: number
}

export type SceneBox = {
  width: number
  height: number
  depth: number
  position: SceneVector
}

export type SceneShelf = SceneBox & {
  id: string
}

export type SceneProduct = SceneBox & {
  id: string
  placementId: string
  sku: string
  facingX: number
  facingY: number
  facingZ: number
}

export type PlanogramThreeSceneModel = {
  equipmentWidth: number
  equipmentHeight: number
  equipmentDepth: number
  cameraPosition: SceneVector
  controlTarget: SceneVector
  floor: SceneBox
  posts: SceneBox[]
  shelves: SceneShelf[]
  products: SceneProduct[]
}

export function mm(value: number): number {
  return value / 1000
}

export function buildPlanogramThreeSceneModel(
  equipment: EquipmentGeometryMm,
  placements: ThreeViewerPlacement[],
): PlanogramThreeSceneModel {
  const equipmentWidth = mm(equipment.widthMm)
  const equipmentHeight = mm(equipment.heightMm)
  const equipmentDepth = mm(equipment.depthMm)

  const shelvesById = new Map(equipment.shelves.map((shelf) => [shelf.id, shelf]))
  const shelves = equipment.shelves.map((shelf) => ({
    id: shelf.id,
    width: equipmentWidth,
    height: mm(shelf.thicknessMm),
    depth: mm(shelf.depthMm),
    position: {
      x: 0,
      y: mm(shelf.yMm + shelf.thicknessMm / 2),
      z: 0,
    },
  }))

  const products = placements.flatMap((placement) => {
    const shelf = shelvesById.get(placement.shelfId)
    if (!shelf) return []
    const oriented = orientedProductSizeMm(placement)
    const faceWidthMm = oriented.widthMm * (placement.compressionX ?? 1)
    const faceHeightMm = oriented.heightMm * (placement.compressionY ?? 1)
    const faceDepthMm = oriented.depthMm * (placement.compressionZ ?? 1)
    const gapMm = placement.gapMm ?? 0
    const width = mm(faceWidthMm)
    const height = mm(faceHeightMm)
    const depth = mm(faceDepthMm)
    const boxes: SceneProduct[] = []

    for (let facingZ = 0; facingZ < placement.facingsZ; facingZ += 1) {
      for (let facingY = 0; facingY < placement.facingsY; facingY += 1) {
        for (let facingX = 0; facingX < placement.facingsX; facingX += 1) {
          boxes.push({
            id: `${placement.id}:${facingX}:${facingY}:${facingZ}`,
            placementId: placement.id,
            sku: placement.product.sku,
            facingX,
            facingY,
            facingZ,
            width,
            height,
            depth,
            position: {
              x:
                -equipmentWidth / 2
                + mm(placement.xMm + facingX * (faceWidthMm + gapMm))
                + width / 2,
              y:
                mm(shelf.yMm + shelf.thicknessMm + facingY * faceHeightMm)
                + height / 2,
              z: mm(shelf.depthMm) / 2 - mm(facingZ * faceDepthMm) - depth / 2,
            },
          })
        }
      }
    }

    return boxes
  })

  return {
    equipmentWidth,
    equipmentHeight,
    equipmentDepth,
    cameraPosition: {
      x: equipmentWidth * 0.28,
      y: equipmentHeight * 0.56,
      z: Math.max(equipmentDepth * 4.2, equipmentWidth * 1.8),
    },
    controlTarget: {
      x: 0,
      y: equipmentHeight * 0.45,
      z: 0,
    },
    floor: {
      width: equipmentWidth * 1.08,
      height: 0.018,
      depth: equipmentDepth * 1.28,
      position: { x: 0, y: -0.018, z: 0 },
    },
    posts: [-1, 1].map((sideX) => ({
      width: 0.028,
      height: equipmentHeight,
      depth: 0.028,
      position: {
        x: sideX * equipmentWidth * 0.5,
        y: equipmentHeight * 0.5,
        z: -equipmentDepth * 0.5,
      },
    })),
    shelves,
    products,
  }
}
