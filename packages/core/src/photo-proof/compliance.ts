export interface ComplianceSlot {
  id: string
  productId: string | null
  productSku: string | null
}

export interface ComplianceDetection {
  slotId: string | null
  productId: string | null
  productSku: string | null
  confidence: number
}

export interface ShelfComplianceScore {
  score: number
  status: "PASS" | "REVIEW" | "FAIL"
  totalSlots: number
  matchedSlots: number
  missingSlots: number
  wrongProducts: number
  extraDetections: number
}

export interface ShelfComplianceFindings {
  missing: Array<{ slotId: string; expectedProductId: string | null; expectedProductSku: string | null }>
  wrong: Array<{
    slotId: string
    expectedProductId: string | null
    expectedProductSku: string | null
    detectedProductId: string | null
    detectedProductSku: string | null
    confidence: number
  }>
  extra: Array<{
    slotId: string | null
    detectedProductId: string | null
    detectedProductSku: string | null
    confidence: number
  }>
}

export interface ShelfComplianceResult extends ShelfComplianceScore {
  findings: ShelfComplianceFindings
}

function sameProduct(slot: ComplianceSlot, detection: ComplianceDetection): boolean {
  if (slot.productId && detection.productId) return slot.productId === detection.productId
  if (slot.productSku && detection.productSku) return slot.productSku === detection.productSku
  if (slot.productId || slot.productSku) return false
  return true
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

export function calculateShelfCompliance({
  slots,
  detections,
  minConfidence = 0.5,
}: {
  slots: ComplianceSlot[]
  detections: ComplianceDetection[]
  minConfidence?: number
}): ShelfComplianceResult {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const findings: ShelfComplianceFindings = { missing: [], wrong: [], extra: [] }
  let matchedSlots = 0
  let missingSlots = 0
  let wrongProducts = 0
  let extraDetections = 0
  let slotScoreSum = 0

  for (const detection of detections) {
    if (!detection.slotId || !slotById.has(detection.slotId)) {
      extraDetections += 1
      findings.extra.push({
        slotId: detection.slotId,
        detectedProductId: detection.productId,
        detectedProductSku: detection.productSku,
        confidence: detection.confidence,
      })
    }
  }

  for (const slot of slots) {
    const candidates = detections
      .filter((detection) => detection.slotId === slot.id)
      .sort((a, b) => b.confidence - a.confidence)
    const best = candidates[0]
    if (!best || best.confidence < minConfidence) {
      missingSlots += 1
      findings.missing.push({
        slotId: slot.id,
        expectedProductId: slot.productId,
        expectedProductSku: slot.productSku,
      })
      continue
    }
    if (!sameProduct(slot, best)) {
      wrongProducts += 1
      findings.wrong.push({
        slotId: slot.id,
        expectedProductId: slot.productId,
        expectedProductSku: slot.productSku,
        detectedProductId: best.productId,
        detectedProductSku: best.productSku,
        confidence: best.confidence,
      })
      slotScoreSum += best.confidence * 0.25
      continue
    }
    matchedSlots += 1
    slotScoreSum += best.confidence
  }

  const score = slots.length === 0 ? 0 : roundScore(slotScoreSum / slots.length)
  return {
    score,
    status: score >= 0.85 ? "PASS" : score >= 0.6 ? "REVIEW" : "FAIL",
    totalSlots: slots.length,
    matchedSlots,
    missingSlots,
    wrongProducts,
    extraDetections,
    findings,
  }
}

export function calculateShelfComplianceScore(input: {
  slots: ComplianceSlot[]
  detections: ComplianceDetection[]
  minConfidence?: number
}): ShelfComplianceScore {
  const { findings: _findings, ...score } = calculateShelfCompliance(input)
  return score
}
