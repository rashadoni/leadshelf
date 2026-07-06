import {
  VISION_PROTOCOL_VERSION,
  visionScanResponseSchema,
  type VisionDetection,
  type VisionScanRequest,
  type VisionScanResponse,
} from "@leadshelf/api-contracts/vision/v1"
import { calculateShelfCompliance } from "@leadshelf/core"
import { Prisma } from "@leadshelf/db"
import { workerDb } from "@/server/db/client"
import { buildVisionMediaUrl } from "@/server/services/vision-media-url"

const LOCAL_STUB_PROVIDER = "leadshelf-stub"
const LOCAL_STUB_MODEL_VERSION = "stub-reference-slots-v1"

type RunVisionComplianceInput = {
  organizationId: string
  photoSubmissionId: string
}

export type RunVisionComplianceResult =
  | { status: "skipped"; reason: string }
  | { status: "created" | "updated"; reviewId: string; score: number; provider: string; modelVersion: string }

function localReferenceSlotScan(request: VisionScanRequest): VisionScanResponse {
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
  const complianceResult = calculateShelfCompliance({
    slots: request.slots.map((slot) => ({
      id: slot.id,
      productId: slot.productId,
      productSku: slot.productSku,
    })),
    detections,
  })

  return {
    protocolVersion: VISION_PROTOCOL_VERSION,
    provider: LOCAL_STUB_PROVIDER,
    modelVersion: LOCAL_STUB_MODEL_VERSION,
    status: request.slots.length > 0 ? "needs_human_review" : "failed",
    detections,
    embedding: null,
    compliance: {
      score: complianceResult.score,
      status: complianceResult.status,
      totalSlots: complianceResult.totalSlots,
      matchedSlots: complianceResult.matchedSlots,
      missingSlots: complianceResult.missingSlots,
      wrongProducts: complianceResult.wrongProducts,
      extraDetections: complianceResult.extraDetections,
    },
    findings: complianceResult.findings,
    warnings: [
      request.slots.length > 0
        ? "stub_provider_uses_reference_slots_without_image_inference"
        : "no_reference_slots_provided",
    ],
  }
}

async function scanWithConfiguredProvider(request: VisionScanRequest): Promise<VisionScanResponse> {
  const serviceUrl = process.env.VISION_SERVICE_URL?.replace(/\/+$/, "")
  if (!serviceUrl) return localReferenceSlotScan(request)

  const res = await fetch(`${serviceUrl}/v1/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`vision_scan_failed:${res.status}`)
  return visionScanResponseSchema.parse(await res.json())
}

export async function runVisionComplianceForPhoto({
  organizationId,
  photoSubmissionId,
}: RunVisionComplianceInput): Promise<RunVisionComplianceResult> {
  const photo = await workerDb.photoSubmission.findFirst({
    where: { id: photoSubmissionId, organizationId },
    select: {
      id: true,
      url: true,
      taskId: true,
      task: { select: { id: true, planogramVersionId: true } },
    },
  })
  if (!photo) return { status: "skipped", reason: "photo_not_found" }
  const planogramVersionId = photo.task?.planogramVersionId
  if (!planogramVersionId) return { status: "skipped", reason: "photo_without_planogram_version" }

  const reference = await workerDb.goldenReference.findFirst({
    where: { organizationId, planogramVersionId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageUrl: true,
      slots: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          placementId: true,
          productId: true,
          label: true,
          xPct: true,
          yPct: true,
          widthPct: true,
          heightPct: true,
          product: { select: { sku: true } },
        },
      },
    },
  })
  if (!reference) return { status: "skipped", reason: "active_golden_reference_not_found" }
  if (reference.slots.length === 0) return { status: "skipped", reason: "active_golden_reference_has_no_slots" }

  const request: VisionScanRequest = {
    protocolVersion: VISION_PROTOCOL_VERSION,
    organizationId,
    planogramVersionId,
    photoSubmissionId: photo.id,
    photoUrl: buildVisionMediaUrl({ key: photo.url }),
    goldenReferenceId: reference.id,
    goldenReferenceUrl: buildVisionMediaUrl({ key: reference.imageUrl }),
    slots: reference.slots.map((slot) => ({
      id: slot.id,
      placementId: slot.placementId,
      productId: slot.productId,
      productSku: slot.product?.sku ?? null,
      label: slot.label,
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    })),
  }
  const response = await scanWithConfiguredProvider(request)
  const scannedAt = new Date().toISOString()
  const findings = {
    vision: {
      scannedAt,
      protocolVersion: response.protocolVersion,
      provider: response.provider,
      modelVersion: response.modelVersion,
      status: response.status,
      compliance: response.compliance,
      findings: response.findings,
      detections: response.detections,
      warnings: response.warnings,
    },
  } satisfies Prisma.JsonObject

  const existing = await workerDb.humanReview.findFirst({
    where: {
      organizationId,
      photoSubmissionId: photo.id,
      reason: "VISION_COMPLIANCE",
    },
    select: { id: true, status: true },
  })
  if (existing) {
    if (existing.status !== "PENDING") {
      return {
        status: "updated",
        reviewId: existing.id,
        score: response.compliance.score,
        provider: response.provider,
        modelVersion: response.modelVersion,
      }
    }
    const review = await workerDb.humanReview.update({
      where: { id: existing.id },
      data: {
        taskId: photo.taskId,
        planogramVersionId,
        goldenReferenceId: reference.id,
        score: response.compliance.score,
        findings,
        note: "Vision compliance check created from photo proof.",
      },
      select: { id: true },
    })
    return {
      status: "updated",
      reviewId: review.id,
      score: response.compliance.score,
      provider: response.provider,
      modelVersion: response.modelVersion,
    }
  }

  const review = await workerDb.humanReview.create({
    data: {
      organizationId,
      reason: "VISION_COMPLIANCE",
      status: "PENDING",
      taskId: photo.taskId,
      photoSubmissionId: photo.id,
      planogramVersionId,
      goldenReferenceId: reference.id,
      score: response.compliance.score,
      findings,
      note: "Vision compliance check created from photo proof.",
    },
    select: { id: true },
  })
  return {
    status: "created",
    reviewId: review.id,
    score: response.compliance.score,
    provider: response.provider,
    modelVersion: response.modelVersion,
  }
}
