import {
  compareShelf,
  type ShelfComparisonResult,
  type ShelfObservedDetection,
} from "@leadshelf/core"

export interface ReviewComparisonPlacementInput {
  id: string
  shelfId: string | null
  facingsX: number
  facingsY: number
  sortOrder: number
  product: {
    id: string
    sku: string
    name: string
    brand: { name: string } | null
  }
}

export interface ReviewComparisonSlotInput {
  id: string
  placementId: string | null
}

export interface BuildReviewShelfComparisonInput {
  canonicalResult?: unknown
  findings: unknown
  analysisStatus: string | null
  placements: ReviewComparisonPlacementInput[]
  referenceSlots: ReviewComparisonSlotInput[]
}

function canonicalComparison(value: unknown): ShelfComparisonResult | null {
  const row = asRecord(value)
  if (
    row.version !== 1 ||
    !["PASS", "REVIEW", "FAIL", "UNAVAILABLE"].includes(String(row.status)) ||
    !Array.isArray(row.placements) ||
    !Array.isArray(row.detections) ||
    !Array.isArray(row.extras) ||
    !Array.isArray(row.actions) ||
    !Array.isArray(row.warnings) ||
    Object.keys(asRecord(row.metrics)).length === 0
  ) return null
  return value as ShelfComparisonResult
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function parseDetections(findings: unknown): { detections: ShelfObservedDetection[]; hasVision: boolean } {
  const vision = asRecord(asRecord(findings).vision)
  const rows = Array.isArray(vision.detections) ? vision.detections : []
  const detections = rows.map((row, index) => {
    const detection = asRecord(row)
    const bbox = asRecord(detection.bbox)
    const parsedBbox = Object.keys(bbox).length > 0
      ? {
          xPct: finiteNumber(bbox.xPct, Number.NaN),
          yPct: finiteNumber(bbox.yPct, Number.NaN),
          widthPct: finiteNumber(bbox.widthPct, Number.NaN),
          heightPct: finiteNumber(bbox.heightPct, Number.NaN),
        }
      : null
    const slotId = nullableString(detection.slotId)
    return {
      detectionId: nullableString(detection.id) ?? slotId ?? `detection-${index + 1}`,
      slotId,
      placementId: nullableString(detection.placementId),
      shelfId: nullableString(detection.shelfId),
      productId: nullableString(detection.productId),
      productSku: nullableString(detection.productSku),
      label: nullableString(detection.label),
      brand: nullableString(detection.brand),
      confidence: finiteNumber(detection.confidence, 0),
      facings: Math.max(1, Math.floor(finiteNumber(detection.facings, 1))),
      bbox: parsedBbox,
      source: detection.source === "manual" ? ("manual" as const) : ("ai" as const),
    }
  })
  return { detections, hasVision: Object.keys(vision).length > 0 }
}

export function buildReviewShelfComparison(
  input: BuildReviewShelfComparisonInput,
): ShelfComparisonResult | null {
  const canonical = canonicalComparison(input.canonicalResult)
  if (canonical) return canonical
  if (input.placements.length === 0) return null
  const parsed = parseDetections(input.findings)
  const analysisAvailable = input.analysisStatus !== "FAILED" && input.analysisStatus !== "SKIPPED" && parsed.hasVision
  return compareShelf({
    expected: input.placements.map((placement) => ({
      placementId: placement.id,
      shelfId: placement.shelfId,
      productId: placement.product.id,
      productSku: placement.product.sku,
      productName: placement.product.name,
      brand: placement.product.brand?.name ?? null,
      expectedFacings: Math.max(1, placement.facingsX) * Math.max(1, placement.facingsY),
      sortOrder: placement.sortOrder,
    })),
    referenceSlots: input.referenceSlots
      .filter((slot): slot is ReviewComparisonSlotInput & { placementId: string } => slot.placementId != null)
      .map((slot) => ({ slotId: slot.id, placementId: slot.placementId })),
    detections: parsed.detections,
    analysisAvailable,
  })
}
