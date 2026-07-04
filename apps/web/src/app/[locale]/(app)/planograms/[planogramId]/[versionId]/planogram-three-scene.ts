import type { EquipmentGeometryMm } from "@leadshelf/core"

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
  sku: string
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
    const width = mm(placement.widthMm * placement.facingsX)
    const height = mm(placement.heightMm * placement.facingsY)
    const depth = mm(placement.depthMm * placement.facingsZ)
    return [
      {
        id: placement.id,
        sku: placement.product.sku,
        width,
        height,
        depth,
        position: {
          x: -equipmentWidth / 2 + mm(placement.xMm) + width / 2,
          y: mm(shelf.yMm + shelf.thicknessMm) + height / 2,
          z: equipmentDepth / 2 - depth / 2,
        },
      },
    ]
  })

  return {
    equipmentWidth,
    equipmentHeight,
    equipmentDepth,
    cameraPosition: {
      x: 0,
      y: equipmentHeight * 0.72,
      z: equipmentDepth * 4,
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
