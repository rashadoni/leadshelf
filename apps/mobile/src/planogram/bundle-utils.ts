import type { Bundle, PlanogramPlacement } from "./PlanogramSvg"

export interface PlacementSummary {
  placementId: string
  sku: string
  name: string
  brandName: string | null
  barcode: string | null
  shelfLabel: string
  dimensionsLabel: string
  facingsLabel: string
  totalUnits: number
  placement: PlanogramPlacement
}

export function placementTotalUnits(p: PlanogramPlacement): number {
  return p.facingsX * p.facingsY * (p.facingsZ ?? 1)
}

export function listPlacementSummaries(bundle: Bundle): PlacementSummary[] {
  const shelfById = new Map(
    bundle.equipment.flatMap((eq) => eq.shelves.map((s) => [s.id, s] as const)),
  )

  return bundle.placements.map((p) => {
    const shelf = p.shelfId ? shelfById.get(p.shelfId) : null
    const facingsZ = p.facingsZ ?? 1
    return {
      placementId: p.id,
      sku: p.product.sku,
      name: p.product.name,
      brandName: p.product.brandName ?? null,
      barcode: p.product.barcode ?? null,
      shelfLabel: shelf?.shelfIndex != null ? String(shelf.shelfIndex + 1) : "-",
      dimensionsLabel: `${p.widthMm}x${p.heightMm}x${p.depthMm ?? "-"} mm`,
      facingsLabel: `${p.facingsX}x${p.facingsY}x${facingsZ}`,
      totalUnits: placementTotalUnits(p),
      placement: p,
    }
  })
}
