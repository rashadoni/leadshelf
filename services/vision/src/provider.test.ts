import { describe, expect, it } from "vitest"
import {
  VISION_PROTOCOL_VERSION,
  visionScanResponseSchema,
  type VisionScanRequest,
} from "@leadshelf/api-contracts/vision/v1"
import { ReferenceSlotStubProvider, STUB_MODEL_VERSION, STUB_PROVIDER } from "./provider"

const request: VisionScanRequest = {
  protocolVersion: VISION_PROTOCOL_VERSION,
  organizationId: "org-a",
  planogramVersionId: "version-a",
  photoSubmissionId: "photo-a",
  photoUrl: "photos/org-a/task-a/photo-a.jpg",
  goldenReferenceId: "reference-a",
  goldenReferenceUrl: "photos/org-a/reference-a.jpg",
  slots: [
    {
      id: "slot-a",
      placementId: "placement-a",
      productId: "product-a",
      productSku: "SKU-A",
      label: "Product A",
      xPct: 10,
      yPct: 20,
      widthPct: 30,
      heightPct: 40,
    },
  ],
}

describe("ReferenceSlotStubProvider", () => {
  it("returns schema-valid low-confidence detections and compliance findings", async () => {
    const response = await new ReferenceSlotStubProvider().scan(request)

    expect(visionScanResponseSchema.parse(response)).toEqual(response)
    expect(response.protocolVersion).toBe(VISION_PROTOCOL_VERSION)
    expect(response.provider).toBe(STUB_PROVIDER)
    expect(response.modelVersion).toBe(STUB_MODEL_VERSION)
    expect(response.status).toBe("needs_human_review")
    expect(response.detections).toEqual([
      {
        slotId: "slot-a",
        productId: "product-a",
        productSku: "SKU-A",
        label: "Product A",
        confidence: 0.35,
        bbox: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 },
      },
    ])
    expect(response.compliance).toEqual({
      score: 0,
      status: "FAIL",
      totalSlots: 1,
      matchedSlots: 0,
      missingSlots: 1,
      wrongProducts: 0,
      extraDetections: 0,
    })
    expect(response.findings.missing).toEqual([
      { slotId: "slot-a", expectedProductId: "product-a", expectedProductSku: "SKU-A" },
    ])
    expect(response.warnings).toContain("stub_provider_uses_reference_slots_without_image_inference")
  })

  it("fails explicitly when no reference slots are provided", async () => {
    const response = await new ReferenceSlotStubProvider().scan({ ...request, slots: [] })

    expect(response.status).toBe("failed")
    expect(response.compliance.totalSlots).toBe(0)
    expect(response.warnings).toContain("no_reference_slots_provided")
  })
})
