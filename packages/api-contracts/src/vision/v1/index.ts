import { z } from "zod"

export const VISION_PROTOCOL_VERSION = 1 as const

export const visionReferenceSlotSchema = z.object({
  id: z.string().min(1),
  placementId: z.string().min(1).nullable(),
  productId: z.string().min(1).nullable(),
  productSku: z.string().min(1).nullable(),
  label: z.string().min(1).nullable(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().min(0.1).max(100),
  heightPct: z.number().min(0.1).max(100),
})
export type VisionReferenceSlot = z.infer<typeof visionReferenceSlotSchema>

export const visionScanRequestSchema = z.object({
  protocolVersion: z.literal(VISION_PROTOCOL_VERSION),
  organizationId: z.string().min(1),
  planogramVersionId: z.string().min(1),
  photoSubmissionId: z.string().min(1),
  photoUrl: z.string().min(1),
  goldenReferenceId: z.string().min(1).optional(),
  goldenReferenceUrl: z.string().min(1).optional(),
  slots: z.array(visionReferenceSlotSchema).max(1000).default([]),
})
export type VisionScanRequest = z.infer<typeof visionScanRequestSchema>

export const visionDetectionSchema = z.object({
  slotId: z.string().min(1).nullable(),
  productId: z.string().min(1).nullable(),
  productSku: z.string().min(1).nullable(),
  label: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  bbox: z.object({
    xPct: z.number().min(0).max(100),
    yPct: z.number().min(0).max(100),
    widthPct: z.number().min(0.1).max(100),
    heightPct: z.number().min(0.1).max(100),
  }),
})
export type VisionDetection = z.infer<typeof visionDetectionSchema>

export const visionEmbeddingSchema = z.object({
  id: z.string().min(1),
  dimensions: z.number().int().min(1),
  provider: z.string().min(1),
})
export type VisionEmbedding = z.infer<typeof visionEmbeddingSchema>

export const visionScanResponseSchema = z.object({
  protocolVersion: z.literal(VISION_PROTOCOL_VERSION),
  provider: z.string().min(1),
  modelVersion: z.string().min(1),
  status: z.enum(["completed", "needs_human_review", "failed"]),
  detections: z.array(visionDetectionSchema),
  embedding: visionEmbeddingSchema.nullable(),
  warnings: z.array(z.string()),
})
export type VisionScanResponse = z.infer<typeof visionScanResponseSchema>

export const visionHealthResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  modelVersion: z.string(),
  protocolVersion: z.literal(VISION_PROTOCOL_VERSION),
})
export type VisionHealthResponse = z.infer<typeof visionHealthResponseSchema>
