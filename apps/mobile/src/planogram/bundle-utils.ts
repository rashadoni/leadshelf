import type { Bundle, PlanogramChangeItem, PlanogramPlacement } from "./PlanogramSvg"

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

export interface ChangeSummary {
  id: string
  kind: PlanogramChangeItem["kind"] | "current"
  sku: string
  name: string
  detail: string
  placementId: string | null
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

function productName(change: PlanogramChangeItem): { sku: string; name: string } {
  return {
    sku: change.product?.sku ?? change.sku ?? "-",
    name: change.product?.name ?? change.name ?? "-",
  }
}

export function listChangeSummaries(bundle: Bundle): ChangeSummary[] {
  if (bundle.changes?.length) {
    return bundle.changes.map((change, index) => {
      const product = productName(change)
      const move =
        change.fromShelfIndex != null && change.toShelfIndex != null
          ? `${change.fromShelfIndex + 1} -> ${change.toShelfIndex + 1}`
          : null
      const facings =
        change.fromFacings && change.toFacings
          ? `${change.fromFacings} -> ${change.toFacings}`
          : null
      return {
        id: `${change.kind}-${change.placementId ?? product.sku}-${index}`,
        kind: change.kind,
        sku: product.sku,
        name: product.name,
        detail: change.note ?? move ?? facings ?? "",
        placementId: change.placementId ?? null,
      }
    })
  }

  return listPlacementSummaries(bundle).map((p) => ({
    id: `current-${p.placementId}`,
    kind: "current",
    sku: p.sku,
    name: p.name,
    detail: `${p.facingsLabel} · ${p.totalUnits}`,
    placementId: p.placementId,
  }))
}
