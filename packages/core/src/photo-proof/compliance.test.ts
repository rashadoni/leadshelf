import { describe, expect, it } from "vitest"
import { calculateShelfCompliance, calculateShelfComplianceScore } from "./compliance.ts"

describe("shelf compliance score", () => {
  it("passes when all slots match with high confidence", () => {
    const result = calculateShelfComplianceScore({
      slots: [
        { id: "slot-1", productId: "p1", productSku: "SKU1" },
        { id: "slot-2", productId: "p2", productSku: "SKU2" },
      ],
      detections: [
        { slotId: "slot-1", productId: "p1", productSku: "SKU1", confidence: 0.92 },
        { slotId: "slot-2", productId: "p2", productSku: "SKU2", confidence: 0.88 },
      ],
    })
    expect(result.status).toBe("PASS")
    expect(result.score).toBe(0.9)
    expect(result.matchedSlots).toBe(2)
  })

  it("penalizes missing and wrong products", () => {
    const result = calculateShelfCompliance({
      slots: [
        { id: "slot-1", productId: "p1", productSku: "SKU1" },
        { id: "slot-2", productId: "p2", productSku: "SKU2" },
      ],
      detections: [
        { slotId: "slot-1", productId: "p3", productSku: "SKU3", confidence: 0.8 },
        { slotId: "unknown", productId: "p9", productSku: "SKU9", confidence: 0.9 },
      ],
    })
    expect(result.status).toBe("FAIL")
    expect(result.wrongProducts).toBe(1)
    expect(result.missingSlots).toBe(1)
    expect(result.extraDetections).toBe(1)
    expect(result.findings.wrong[0]).toMatchObject({
      slotId: "slot-1",
      expectedProductSku: "SKU1",
      detectedProductSku: "SKU3",
    })
    expect(result.findings.missing[0]).toMatchObject({ slotId: "slot-2" })
    expect(result.findings.extra[0]).toMatchObject({ slotId: "unknown", detectedProductSku: "SKU9" })
  })
})
