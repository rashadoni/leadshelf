export const SHELF_COMPARISON_VERSION = 1 as const

export type ShelfComparisonStatus = "PASS" | "REVIEW" | "FAIL" | "UNAVAILABLE"
export type ShelfDetectionSource = "ai" | "manual"
export type ShelfPlacementOutcome =
  | "matched"
  | "missing"
  | "wrong_product"
  | "wrong_position"
  | "facing_mismatch"
  | "unavailable"

export type ShelfActionType = "restock" | "add_facings" | "remove_facings" | "move" | "manual_review"

export interface ShelfBBox {
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export interface ShelfExpectedPlacement {
  placementId: string
  shelfId: string | null
  productId: string | null
  productSku: string | null
  productName: string
  brand: string | null
  expectedFacings: number
  sortOrder?: number
}

export interface ShelfReferenceSlot {
  slotId: string
  placementId: string
}

export interface ShelfObservedDetection {
  detectionId: string
  slotId?: string | null
  placementId?: string | null
  shelfId?: string | null
  productId: string | null
  productSku: string | null
  label: string | null
  brand?: string | null
  confidence: number
  facings?: number
  bbox?: ShelfBBox | null
  source?: ShelfDetectionSource
}

export interface ShelfComparisonAction {
  type: ShelfActionType
  placementId: string | null
  productId: string | null
  productSku: string | null
  amount: number | null
}

export interface ShelfPlacementComparison {
  placementId: string
  shelfId: string | null
  productId: string | null
  productSku: string | null
  productName: string
  brand: string | null
  expectedFacings: number
  actualFacings: number | null
  outcome: ShelfPlacementOutcome
  confidence: number | null
  detectionIds: string[]
  action: ShelfComparisonAction | null
}

export interface ShelfVisualDetection {
  detectionId: string
  slotId: string | null
  placementId: string | null
  shelfId: string | null
  productId: string | null
  productSku: string | null
  label: string | null
  brand: string | null
  confidence: number
  facings: number
  bbox: ShelfBBox | null
  source: ShelfDetectionSource
}

export interface ShelfShareEntry {
  key: string
  label: string
  facings: number
  sharePct: number
}

export interface ShelfBrandShareEntry {
  brand: string
  facings: number
  sharePct: number
  isCompetitor: boolean
}

export interface ShelfOosEntry {
  productId: string | null
  productSku: string | null
  productName: string
  expectedFacings: number
  actualFacings: number
  deficit: number
}

export interface ShelfComparisonMetrics {
  lenientCompliance: number | null
  strictCompliance: number | null
  expectedFacings: number
  actualFacings: number | null
  oos: ShelfOosEntry[]
  shareOfShelf: ShelfShareEntry[]
  brandShare: ShelfBrandShareEntry[]
  ourBrandSharePct: number | null
  competitorSharePct: number | null
}

export interface ShelfComparisonResult {
  version: typeof SHELF_COMPARISON_VERSION
  status: ShelfComparisonStatus
  structuralScore: number | null
  visualConfidence: number | null
  strictCompliance: boolean
  placements: ShelfPlacementComparison[]
  detections: ShelfVisualDetection[]
  extras: ShelfVisualDetection[]
  actions: ShelfComparisonAction[]
  metrics: ShelfComparisonMetrics
  warnings: string[]
}

export interface CompareShelfInput {
  expected: ShelfExpectedPlacement[]
  detections: ShelfObservedDetection[]
  referenceSlots?: ShelfReferenceSlot[]
  analysisAvailable?: boolean
  strictCompliance?: boolean
  minConfidence?: number
  passScore?: number
  reviewScore?: number
  competitorBucketLabel?: string
}

interface NormalizedDetection extends ShelfVisualDetection {
  productKey: string | null
  targetPlacementId: string | null
  candidatePlacementIds: string[]
  usable: boolean
  consumed: boolean
}

interface ProductAggregate {
  key: string
  productId: string | null
  productSku: string | null
  productName: string
  brand: string | null
  expectedFacings: number
  actualFacings: number
}

function normalizedSku(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase()
  return normalized ? normalized : null
}

function expectedProductKey(value: Pick<ShelfExpectedPlacement, "placementId" | "productId" | "productSku">): string {
  if (value.productId) return `id:${value.productId}`
  const sku = normalizedSku(value.productSku)
  return sku ? `sku:${sku}` : `placement:${value.placementId}`
}

function detectionProductKey(value: Pick<ShelfObservedDetection, "productId" | "productSku">): string | null {
  if (value.productId) return `id:${value.productId}`
  const sku = normalizedSku(value.productSku)
  return sku ? `sku:${sku}` : null
}

function productsMatch(
  expected: Pick<ShelfExpectedPlacement, "productId" | "productSku">,
  detection: Pick<ShelfObservedDetection, "productId" | "productSku">,
): boolean {
  if (expected.productId && detection.productId) return expected.productId === detection.productId
  const expectedSku = normalizedSku(expected.productSku)
  const detectedSku = normalizedSku(detection.productSku)
  return Boolean(expectedSku && detectedSku && expectedSku === detectedSku)
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

export function isValidShelfBBox(value: ShelfBBox | null | undefined): value is ShelfBBox {
  if (!value) return false
  if (![value.xPct, value.yPct, value.widthPct, value.heightPct].every(finite)) return false
  if (value.xPct < 0 || value.yPct < 0 || value.widthPct <= 0 || value.heightPct <= 0) return false
  return value.xPct + value.widthPct <= 100 && value.yPct + value.heightPct <= 100
}

function positiveInteger(value: number | undefined, fallback = 1): number {
  if (!Number.isFinite(value) || value == null) return fallback
  return Math.max(1, Math.floor(value))
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function roundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

function comparePlacementOrder(a: ShelfExpectedPlacement, b: ShelfExpectedPlacement): number {
  return (
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    (a.shelfId ?? "").localeCompare(b.shelfId ?? "") ||
    a.placementId.localeCompare(b.placementId)
  )
}

function compareDetectionOrder(a: ShelfObservedDetection, b: ShelfObservedDetection): number {
  return a.detectionId.localeCompare(b.detectionId)
}

function largestRemainder(entries: Array<{ key: string; facings: number }>): Map<string, number> {
  const total = entries.reduce((sum, entry) => sum + entry.facings, 0)
  if (total <= 0) return new Map(entries.map((entry) => [entry.key, 0]))
  const rows = entries.map((entry) => {
    const exact = (entry.facings / total) * 100
    const floor = Math.floor(exact)
    return { ...entry, floor, remainder: exact - floor }
  })
  let remaining = 100 - rows.reduce((sum, row) => sum + row.floor, 0)
  const ranked = [...rows].sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key))
  const result = new Map(rows.map((row) => [row.key, row.floor]))
  for (const row of ranked) {
    if (remaining <= 0) break
    result.set(row.key, (result.get(row.key) ?? 0) + 1)
    remaining -= 1
  }
  return result
}

function actionForPlacement(
  placement: ShelfExpectedPlacement,
  outcome: ShelfPlacementOutcome,
  actualFacings: number,
  uncertain: boolean,
): ShelfComparisonAction | null {
  const base = {
    placementId: placement.placementId,
    productId: placement.productId,
    productSku: placement.productSku,
  }
  if (uncertain) return { ...base, type: "manual_review", amount: null }
  if (outcome === "missing") return { ...base, type: "restock", amount: placement.expectedFacings }
  if (outcome === "wrong_product" || outcome === "wrong_position") {
    return { ...base, type: "move", amount: placement.expectedFacings }
  }
  if (outcome === "facing_mismatch") {
    const delta = placement.expectedFacings - actualFacings
    return {
      ...base,
      type: delta > 0 ? "add_facings" : "remove_facings",
      amount: Math.abs(delta),
    }
  }
  return null
}

function normalizeDetections(
  detections: ShelfObservedDetection[],
  slots: Map<string, string>,
  placementIds: Set<string>,
  minConfidence: number,
  warnings: string[],
): NormalizedDetection[] {
  return [...detections].sort(compareDetectionOrder).map((detection) => {
    const bbox = isValidShelfBBox(detection.bbox) ? detection.bbox : null
    if (detection.bbox && !bbox) warnings.push(`invalid_bbox:${detection.detectionId}`)
    const confidence = clampConfidence(detection.confidence)
    if (!finite(detection.confidence)) warnings.push(`invalid_confidence:${detection.detectionId}`)
    const explicitPlacementId = detection.placementId && placementIds.has(detection.placementId)
      ? detection.placementId
      : null
    const slotPlacementId = detection.slotId ? slots.get(detection.slotId) ?? null : null
    const targetPlacementId = explicitPlacementId ?? slotPlacementId
    return {
      detectionId: detection.detectionId,
      slotId: detection.slotId ?? null,
      placementId: targetPlacementId,
      targetPlacementId,
      shelfId: detection.shelfId ?? null,
      productId: detection.productId,
      productSku: normalizedSku(detection.productSku),
      label: detection.label?.trim() || null,
      brand: detection.brand?.trim() || null,
      confidence,
      facings: positiveInteger(detection.facings),
      bbox,
      source: detection.source ?? "ai",
      productKey: detectionProductKey(detection),
      candidatePlacementIds: [],
      usable: detection.source === "manual" || confidence >= minConfidence,
      consumed: false,
    }
  })
}

function buildProductAggregates(
  expected: ShelfExpectedPlacement[],
  detections: NormalizedDetection[],
): ProductAggregate[] {
  const products = new Map<string, ProductAggregate>()
  for (const placement of expected) {
    const key = expectedProductKey(placement)
    const current = products.get(key)
    if (current) {
      current.expectedFacings += placement.expectedFacings
    } else {
      products.set(key, {
        key,
        productId: placement.productId,
        productSku: normalizedSku(placement.productSku),
        productName: placement.productName,
        brand: placement.brand?.trim() || null,
        expectedFacings: placement.expectedFacings,
        actualFacings: 0,
      })
    }
  }
  for (const detection of detections) {
    if (!detection.usable || !detection.productKey) continue
    const product = products.get(detection.productKey)
    if (product) product.actualFacings += detection.facings
  }
  return [...products.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function calculateCompliance(placements: ShelfPlacementComparison[]): { lenient: number | null; strict: number | null } {
  if (placements.length === 0 || placements.some((placement) => placement.outcome === "unavailable")) {
    return { lenient: null, strict: null }
  }
  const lenient = placements.reduce(
    (sum, placement) =>
      sum +
      (placement.outcome === "matched" || placement.outcome === "facing_mismatch"
        ? Math.min((placement.actualFacings ?? 0) / placement.expectedFacings, 1)
        : 0),
    0,
  )
  const strict = placements.reduce(
    (sum, placement) =>
      sum +
      (placement.outcome === "matched" || placement.outcome === "facing_mismatch"
        ? Math.max(
            0,
            1 - Math.abs((placement.actualFacings ?? 0) - placement.expectedFacings) / placement.expectedFacings,
          )
        : 0),
    0,
  )
  return {
    lenient: roundedScore((lenient / placements.length) * 100),
    strict: roundedScore((strict / placements.length) * 100),
  }
}

function shelfShare(detections: NormalizedDetection[]): ShelfShareEntry[] {
  const buckets = new Map<string, { label: string; facings: number }>()
  for (const detection of detections) {
    if (!detection.usable) continue
    const label = detection.productSku ?? detection.label ?? "Unknown"
    const key = detection.productKey ?? `label:${label.toUpperCase()}`
    const current = buckets.get(key) ?? { label, facings: 0 }
    current.facings += detection.facings
    buckets.set(key, current)
  }
  const rows = [...buckets.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.key.localeCompare(b.key))
  const shares = largestRemainder(rows)
  return rows.map((row) => ({ ...row, sharePct: shares.get(row.key) ?? 0 }))
}

function brandShare(
  detections: NormalizedDetection[],
  products: ProductAggregate[],
  competitorBucketLabel: string,
): {
  rows: ShelfBrandShareEntry[]
  ourBrandSharePct: number | null
  competitorSharePct: number | null
} {
  const expectedByKey = new Map(products.map((product) => [product.key, product]))
  const buckets = new Map<string, { facings: number; isCompetitor: boolean }>()
  for (const detection of detections) {
    if (!detection.usable) continue
    const expectedProduct = detection.productKey ? expectedByKey.get(detection.productKey) : null
    const brand = expectedProduct?.brand ?? detection.brand ?? competitorBucketLabel
    const isCompetitor = !expectedProduct
    const key = `${isCompetitor ? "competitor" : "ours"}:${brand}`
    const current = buckets.get(key) ?? { facings: 0, isCompetitor }
    current.facings += detection.facings
    buckets.set(key, current)
  }
  const sourceRows = [...buckets.entries()]
    .map(([key, value]) => ({ key, brand: key.slice(key.indexOf(":") + 1), ...value }))
    .sort((a, b) => a.key.localeCompare(b.key))
  if (sourceRows.length === 0) return { rows: [], ourBrandSharePct: null, competitorSharePct: null }
  const shares = largestRemainder(sourceRows)
  const rows = sourceRows.map(({ key, ...row }) => ({ ...row, sharePct: shares.get(key) ?? 0 }))
  const competitorSharePct = rows
    .filter((row) => row.isCompetitor)
    .reduce((sum, row) => sum + row.sharePct, 0)
  return {
    rows,
    ourBrandSharePct: 100 - competitorSharePct,
    competitorSharePct,
  }
}

export function compareShelf(input: CompareShelfInput): ShelfComparisonResult {
  const minConfidence = clampConfidence(input.minConfidence ?? 0.5)
  const passScore = roundedScore(input.passScore ?? 85)
  const reviewScore = roundedScore(input.reviewScore ?? 60)
  const strictCompliance = input.strictCompliance ?? false
  const warnings: string[] = []
  const expected = [...input.expected]
    .map((placement) => ({
      ...placement,
      productSku: normalizedSku(placement.productSku),
      brand: placement.brand?.trim() || null,
      expectedFacings: positiveInteger(placement.expectedFacings),
    }))
    .sort(comparePlacementOrder)
  const placementById = new Map(expected.map((placement) => [placement.placementId, placement]))
  const slotToPlacement = new Map(
    (input.referenceSlots ?? [])
      .filter((slot) => placementById.has(slot.placementId))
      .sort((a, b) => a.slotId.localeCompare(b.slotId))
      .map((slot) => [slot.slotId, slot.placementId]),
  )
  const detections = normalizeDetections(
    input.detections,
    slotToPlacement,
    new Set(placementById.keys()),
    minConfidence,
    warnings,
  )
  for (const detection of detections) {
    const matchingExpected = expected.find((placement) => productsMatch(placement, detection))
    if (matchingExpected) detection.productKey = expectedProductKey(matchingExpected)
  }
  for (const detection of detections) {
    if (detection.targetPlacementId || !detection.usable) continue
    const candidates = expected.filter(
      (placement) =>
        productsMatch(placement, detection) &&
        (detection.shelfId == null || placement.shelfId === detection.shelfId),
    )
    detection.candidatePlacementIds = candidates.map((placement) => placement.placementId)
    if (candidates.length === 1) {
      detection.targetPlacementId = candidates[0]!.placementId
      detection.placementId = candidates[0]!.placementId
    } else if (candidates.length > 1) {
      warnings.push(`ambiguous_placement:${detection.detectionId}`)
    }
  }

  const placementResults: ShelfPlacementComparison[] = []
  for (const placement of expected) {
    const targeted = detections.filter((detection) => detection.targetPlacementId === placement.placementId)
    const correctTargeted = targeted.filter((detection) => detection.usable && productsMatch(placement, detection))
    for (const detection of correctTargeted) detection.consumed = true
    const wrongTargeted = targeted.filter((detection) => detection.usable && !productsMatch(placement, detection))
    for (const detection of wrongTargeted) detection.consumed = true
    const ambiguousCandidates = detections.filter(
      (detection) =>
        !detection.targetPlacementId &&
        detection.candidatePlacementIds.includes(placement.placementId),
    )
    const uncertainTargeted = [
      ...targeted.filter((detection) => !detection.usable),
      ...(correctTargeted.length === 0 && wrongTargeted.length === 0 ? ambiguousCandidates : []),
    ]

    const assigned = correctTargeted
    const wrongPosition =
      assigned.length === 0 &&
      wrongTargeted.length === 0 &&
      detections.some(
        (detection) =>
          detection.usable &&
          productsMatch(placement, detection) &&
          ((detection.targetPlacementId && detection.targetPlacementId !== placement.placementId) ||
            (detection.shelfId != null && detection.shelfId !== placement.shelfId)),
      )

    const actualFacings = assigned.reduce((sum, detection) => sum + detection.facings, 0)
    const confidence = average([...assigned, ...wrongTargeted, ...uncertainTargeted].map((detection) => detection.confidence))
    const uncertain = uncertainTargeted.length > 0 && assigned.length === 0 && wrongTargeted.length === 0
    let outcome: ShelfPlacementOutcome
    if (assigned.length > 0) {
      outcome = actualFacings === placement.expectedFacings ? "matched" : "facing_mismatch"
    } else if (wrongTargeted.length > 0) {
      outcome = "wrong_product"
    } else if (wrongPosition) {
      outcome = "wrong_position"
    } else {
      outcome = "missing"
    }
    const detectionIds = [...assigned, ...wrongTargeted, ...uncertainTargeted]
      .map((detection) => detection.detectionId)
      .sort()
    placementResults.push({
      placementId: placement.placementId,
      shelfId: placement.shelfId,
      productId: placement.productId,
      productSku: placement.productSku,
      productName: placement.productName,
      brand: placement.brand,
      expectedFacings: placement.expectedFacings,
      actualFacings: uncertain ? null : actualFacings,
      outcome: uncertain ? "unavailable" : outcome,
      confidence,
      detectionIds,
      action: actionForPlacement(placement, outcome, actualFacings, uncertain),
    })
  }

  const extras = detections.filter((detection) => detection.usable && !detection.consumed)
  const products = buildProductAggregates(expected, detections)
  const compliance = calculateCompliance(placementResults)
  const shareOfShelf = shelfShare(detections)
  const brands = brandShare(detections, products, input.competitorBucketLabel ?? "Competitor / Other")
  const uncertainProductKeys = new Set(
    placementResults
      .filter((placement) => placement.outcome === "unavailable")
      .map((placement) => expectedProductKey(placement)),
  )
  const oos = products
    .filter(
      (product) =>
        !uncertainProductKeys.has(product.key) &&
        product.actualFacings < product.expectedFacings,
    )
    .map((product) => ({
      productId: product.productId,
      productSku: product.productSku,
      productName: product.productName,
      expectedFacings: product.expectedFacings,
      actualFacings: product.actualFacings,
      deficit: product.expectedFacings - product.actualFacings,
    }))
  const structuralScore = strictCompliance ? compliance.strict : compliance.lenient
  const hasUncertainPlacements = placementResults.some((placement) => placement.outcome === "unavailable")
  const visualConfidence = average(detections.filter((detection) => detection.bbox).map((detection) => detection.confidence))
  const analysisAvailable = input.analysisAvailable ?? true
  const finalPlacements = analysisAvailable
    ? placementResults
    : placementResults.map((placement) => ({
        ...placement,
        actualFacings: null,
        outcome: "unavailable" as const,
        confidence: null,
        action: null,
      }))
  const actions = finalPlacements
    .map((placement) => placement.action)
    .filter((action): action is ShelfComparisonAction => action != null)
    .sort((a, b) =>
      a.type.localeCompare(b.type) ||
      (a.productSku ?? "").localeCompare(b.productSku ?? "") ||
      (a.placementId ?? "").localeCompare(b.placementId ?? ""),
    )
  for (const detection of detections.filter((detection) => !detection.usable)) {
    if (!warnings.includes(`low_confidence:${detection.detectionId}`)) {
      warnings.push(`low_confidence:${detection.detectionId}`)
    }
  }
  warnings.sort()

  let status: ShelfComparisonStatus
  if (!analysisAvailable) {
    status = "UNAVAILABLE"
  } else if (
    warnings.some(
      (warning) =>
        warning.startsWith("low_confidence:") ||
        warning.startsWith("invalid_bbox:") ||
        warning.startsWith("ambiguous_placement:"),
    )
  ) {
    status = "REVIEW"
  } else if (structuralScore == null) {
    status = "UNAVAILABLE"
  } else if (actions.length > 0 && structuralScore >= passScore) {
    // Keep the numeric compliance score independent from the workflow status:
    // an actionable discrepancy must not be presented as a clean pass.
    status = "REVIEW"
  } else if (structuralScore >= passScore) {
    status = "PASS"
  } else if (structuralScore >= reviewScore) {
    status = "REVIEW"
  } else {
    status = "FAIL"
  }

  return {
    version: SHELF_COMPARISON_VERSION,
    status,
    structuralScore: analysisAvailable ? structuralScore : null,
    visualConfidence,
    strictCompliance,
    placements: finalPlacements,
    detections: detections.map(
      ({
        productKey: _productKey,
        targetPlacementId: _target,
        candidatePlacementIds: _candidates,
        usable: _usable,
        consumed: _consumed,
        ...detection
      }) => detection,
    ),
    extras: extras.map(
      ({
        productKey: _productKey,
        targetPlacementId: _target,
        candidatePlacementIds: _candidates,
        usable: _usable,
        consumed: _consumed,
        ...detection
      }) => detection,
    ),
    actions,
    metrics: {
      lenientCompliance: analysisAvailable ? compliance.lenient : null,
      strictCompliance: analysisAvailable ? compliance.strict : null,
      expectedFacings: products.reduce((sum, product) => sum + product.expectedFacings, 0),
      actualFacings: analysisAvailable && !hasUncertainPlacements
        ? detections.filter((detection) => detection.usable).reduce((sum, detection) => sum + detection.facings, 0)
        : null,
      oos: analysisAvailable ? oos : [],
      shareOfShelf: analysisAvailable ? shareOfShelf : [],
      brandShare: analysisAvailable ? brands.rows : [],
      ourBrandSharePct: analysisAvailable ? brands.ourBrandSharePct : null,
      competitorSharePct: analysisAvailable ? brands.competitorSharePct : null,
    },
    warnings,
  }
}
