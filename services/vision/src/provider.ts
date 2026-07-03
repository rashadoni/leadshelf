import {
  VISION_PROTOCOL_VERSION,
  type VisionDetection,
  type VisionScanRequest,
  type VisionScanResponse,
} from "@leadshelf/api-contracts/vision/v1"
import { calculateShelfComplianceScore } from "@leadshelf/core"

export const STUB_PROVIDER = "leadshelf-stub"
export const STUB_MODEL_VERSION = "stub-reference-slots-v1"

export interface VisionProvider {
  scan(request: VisionScanRequest): Promise<VisionScanResponse>
}

export class ReferenceSlotStubProvider implements VisionProvider {
  async scan(request: VisionScanRequest): Promise<VisionScanResponse> {
    const detections: VisionDetection[] = request.slots.map((slot) => ({
      slotId: slot.id,
      productId: slot.productId,
      productSku: slot.productSku,
      label: slot.label,
      confidence: 0.35,
      bbox: {
        xPct: slot.xPct,
        yPct: slot.yPct,
        widthPct: slot.widthPct,
        heightPct: slot.heightPct,
      },
    }))
    const compliance = calculateShelfComplianceScore({
      slots: request.slots.map((slot) => ({
        id: slot.id,
        productId: slot.productId,
        productSku: slot.productSku,
      })),
      detections,
    })

    return {
      protocolVersion: VISION_PROTOCOL_VERSION,
      provider: STUB_PROVIDER,
      modelVersion: STUB_MODEL_VERSION,
      status: request.slots.length > 0 ? "needs_human_review" : "failed",
      detections,
      embedding: null,
      compliance,
      warnings: [
        request.slots.length > 0
          ? "stub_provider_uses_reference_slots_without_image_inference"
          : "no_reference_slots_provided",
      ],
    }
  }
}
