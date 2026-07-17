import {
  mobilePromotionSubmitPayloadSchema,
  mobileSalesReturnCreatePayloadSchema,
  type MobileCommercialMediaPurpose,
  type MobilePromotionSubmitPayload,
  type MobileSalesReturnCreatePayload,
} from "@leadshelf/api-contracts/mobile/v1"

export type CommercialMediaOperationKind = "promotion.submit" | "return.create"

export function detachCommercialMediaFromOperation(input: {
  kind: CommercialMediaOperationKind
  payload: unknown
  purpose: MobileCommercialMediaPurpose
}): MobilePromotionSubmitPayload | MobileSalesReturnCreatePayload {
  const payload = { ...(input.payload as Record<string, unknown>) }
  if (input.kind === "promotion.submit" && input.purpose === "PROMOTION_PROOF") {
    delete payload.proofPhotoUrl
    return mobilePromotionSubmitPayloadSchema.parse(payload)
  }
  if (input.kind === "return.create" && input.purpose === "RETURN_EVIDENCE") {
    delete payload.evidencePhotoUrl
    return mobileSalesReturnCreatePayloadSchema.parse(payload)
  }
  throw new Error("Commercial media operation kind mismatch")
}

export function attachCommercialMediaToOperation(input: {
  kind: CommercialMediaOperationKind
  payload: unknown
  purpose: MobileCommercialMediaPurpose
  key: string
}): MobilePromotionSubmitPayload | MobileSalesReturnCreatePayload {
  if (input.kind === "promotion.submit" && input.purpose === "PROMOTION_PROOF") {
    return mobilePromotionSubmitPayloadSchema.parse({
      ...(input.payload as Record<string, unknown>),
      proofPhotoUrl: input.key,
    })
  }
  if (input.kind === "return.create" && input.purpose === "RETURN_EVIDENCE") {
    return mobileSalesReturnCreatePayloadSchema.parse({
      ...(input.payload as Record<string, unknown>),
      evidencePhotoUrl: input.key,
    })
  }
  throw new Error("Commercial media operation kind mismatch")
}
