import { NextResponse, type NextRequest } from "next/server"
import {
  mobileCaptureStepSchema,
  mobilePhotoUploadFieldsSchema,
  type MobileCaptureStep,
} from "@leadshelf/api-contracts/mobile/v1"
import {
  evaluatePhotoProofMetadata,
  evaluateProofMediaQuality,
  selectProofVideoFrameTimestamps,
} from "@leadshelf/core"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"
import {
  runVisionComplianceForPhoto,
  type RunVisionComplianceResult,
} from "@/server/services/vision-compliance"
import { putObject } from "@/server/storage/s3"

export const runtime = "nodejs"
export const maxDuration = 120

// Пилот: multipart через приложение (MinIO не публичен, docs/18 решение d).
// Идемпотентность: [organizationId, clientPhotoId] — ретрай не плодит дублей.

const MAX_PHOTO_SIZE = 15 * 1024 * 1024
const MAX_VIDEO_SIZE = 35 * 1024 * 1024
const ALLOWED: Record<string, { ext: string; mediaType: "photo" | "video" }> = {
  "image/jpeg": { ext: "jpg", mediaType: "photo" },
  "image/png": { ext: "png", mediaType: "photo" },
  "image/webp": { ext: "webp", mediaType: "photo" },
  "video/mp4": { ext: "mp4", mediaType: "video" },
  "video/quicktime": { ext: "mov", mediaType: "video" },
  "video/webm": { ext: "webm", mediaType: "video" },
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asJsonObject(value: unknown): JsonObject {
  return asObjectRecord(value) as JsonObject
}

function parseCaptureStep(raw: string | undefined): MobileCaptureStep | null | "invalid" {
  if (!raw) return null
  try {
    const parsed = mobileCaptureStepSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : "invalid"
  } catch {
    return "invalid"
  }
}

function skippedVision(reason: string): RunVisionComplianceResult {
  return { status: "skipped", reason }
}

function visionAnalysisPatch(result: RunVisionComplianceResult) {
  if ("reviewId" in result) {
    return {
      analysisStatus: "COMPLETED" as const,
      analysisProvider: result.provider,
      analysisModelVersion: result.modelVersion,
      analysisError: null,
      analysisFinishedAt: new Date(),
    }
  }
  const failed = result.reason.startsWith("vision_scan_failed") || result.reason.includes("failed")
  return {
    analysisStatus: failed ? ("FAILED" as const) : ("SKIPPED" as const),
    analysisProvider: null,
    analysisModelVersion: null,
    analysisError: result.reason,
    analysisFinishedAt: new Date(),
  }
}

async function markPhotoVisionAnalysis(photoSubmissionId: string, result: RunVisionComplianceResult): Promise<void> {
  await workerDb.photoSubmission.update({
    where: { id: photoSubmissionId },
    data: visionAnalysisPatch(result),
  })
}

async function ensureQueuedVideoVisionReview(input: {
  organizationId: string
  taskId: string | null
  photoSubmissionId: string
  planogramVersionId: string | null
  framePlan: unknown
}): Promise<string> {
  const existing = await workerDb.humanReview.findFirst({
    where: {
      organizationId: input.organizationId,
      photoSubmissionId: input.photoSubmissionId,
      reason: "VISION_COMPLIANCE",
    },
    select: { id: true },
  })
  if (existing) return existing.id

  const review = await workerDb.humanReview.create({
    data: {
      organizationId: input.organizationId,
      reason: "VISION_COMPLIANCE",
      status: "PENDING",
      taskId: input.taskId,
      photoSubmissionId: input.photoSubmissionId,
      planogramVersionId: input.planogramVersionId,
      findings: {
        vision: {
          workerStatus: "queued",
          mediaType: "video",
          framePlan: input.framePlan ?? null,
          queuedAt: new Date().toISOString(),
          warnings: ["video_waiting_frame_extraction"],
        },
      },
      note: "Video proof queued for frame extraction and selected-frame AI analysis.",
    },
    select: { id: true },
  })
  return review.id
}

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 })
  const parsed = mobilePhotoUploadFieldsSchema.safeParse({
    clientPhotoId: form!.get("clientPhotoId"),
    taskId: form!.get("taskId"),
    takenAt: form!.get("takenAt"),
    mediaType: form!.get("mediaType") ?? undefined,
    durationMs: form!.get("durationMs") ?? undefined,
    captureStepJson: form!.get("captureStepJson") ?? undefined,
    exifJson: form!.get("exifJson") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  const uploadType = ALLOWED[file.type]
  if (!uploadType) return NextResponse.json({ error: "unsupported_type" }, { status: 415 })
  if (uploadType.mediaType !== parsed.data.mediaType) {
    return NextResponse.json({ error: "media_type_mismatch" }, { status: 400 })
  }
  const maxSize = uploadType.mediaType === "video" ? MAX_VIDEO_SIZE : MAX_PHOTO_SIZE
  if (file.size > maxSize) return NextResponse.json({ error: "too_large" }, { status: 413 })
  if (uploadType.mediaType === "video" && parsed.data.durationMs == null) {
    return NextResponse.json({ error: "video_duration_required" }, { status: 400 })
  }
  const captureStep = parseCaptureStep(parsed.data.captureStepJson)
  if (captureStep === "invalid") return NextResponse.json({ error: "invalid_capture_step" }, { status: 400 })
  if (captureStep && captureStep.mediaKind !== uploadType.mediaType) {
    return NextResponse.json({ error: "capture_step_media_mismatch" }, { status: 400 })
  }

  // дедуп до записи файла
  const existing = await workerDb.photoSubmission.findFirst({
    where: { organizationId: session.org, clientPhotoId: parsed.data.clientPhotoId },
    select: {
      id: true,
      url: true,
      qualityScore: true,
      exif: true,
      mediaType: true,
      durationMs: true,
      taskId: true,
      task: { select: { planogramVersionId: true } },
      analysisStatus: true,
    },
  })
  if (existing) {
    const existingExif = asObjectRecord(existing.exif)
    const existingMediaType = existing.mediaType === "VIDEO" ? "video" : "photo"
    const visionResult =
      existingMediaType === "photo"
        ? await runVisionComplianceForPhoto({
            organizationId: session.org,
            photoSubmissionId: existing.id,
          }).catch((error: unknown) =>
            skippedVision(error instanceof Error ? error.message : "vision_scan_failed"),
          )
        : skippedVision("vision_queued_frame_extraction")
    if (existingMediaType === "photo") await markPhotoVisionAnalysis(existing.id, visionResult)
    const nextAnalysisStatus =
      existingMediaType === "photo" ? visionAnalysisPatch(visionResult).analysisStatus : existing.analysisStatus
    const queuedVideoReviewId =
      existingMediaType === "video"
        ? await ensureQueuedVideoVisionReview({
            organizationId: session.org,
            taskId: existing.taskId,
            photoSubmissionId: existing.id,
            planogramVersionId: existing.task?.planogramVersionId ?? null,
            framePlan: asObjectRecord(existingExif.qualityCheck).framePlan ?? null,
          })
        : null
    return NextResponse.json({
      photoId: existing.id,
      key: existing.url,
      mediaType: existingMediaType,
      durationMs: existing.durationMs,
      analysisStatus: nextAnalysisStatus,
      qualityScore: existing.qualityScore,
      qualityCheck: existingExif.qualityCheck ?? null,
      deduplicated: true,
      visionReviewId: "reviewId" in visionResult ? visionResult.reviewId : queuedVideoReviewId,
      visionStatus: existingMediaType === "video" ? "queued" : visionResult.status,
      visionReason: "reason" in visionResult ? visionResult.reason : null,
    })
  }

  const task = await workerDb.task.findFirst({
    where: { id: parsed.data.taskId, organizationId: session.org, assigneeId: session.sub },
    select: {
      id: true,
      storeId: true,
      planogramVersionId: true,
      store: { select: { latitude: true, longitude: true } },
    },
  })
  if (!task) return NextResponse.json({ error: "task_not_found_or_not_assigned" }, { status: 404 })

  const key = `${uploadType.mediaType === "video" ? "videos" : "photos"}/${session.org}/${task.id}/${parsed.data.clientPhotoId}.${uploadType.ext}`
  const bytes = Buffer.from(await file.arrayBuffer())
  await putObject(key, bytes, file.type)

  let exif: object | undefined
  try {
    exif = parsed.data.exifJson ? JSON.parse(parsed.data.exifJson) : undefined
  } catch {
    exif = undefined
  }
  const qualityCheck = evaluateProofMediaQuality({
    bytes,
    mimeType: file.type,
    takenAt: new Date(parsed.data.takenAt),
    exif,
    mediaType: uploadType.mediaType,
    durationMs: parsed.data.durationMs ?? null,
    captureStep,
  })
  const proofMetadata = evaluatePhotoProofMetadata({
    exif,
    takenAt: new Date(parsed.data.takenAt),
    expectedUserId: session.sub,
    expectedTaskId: task.id,
    expectedStoreId: task.storeId,
    expectedStoreLocation:
      task.store.latitude == null || task.store.longitude == null
        ? null
        : { latitude: task.store.latitude, longitude: task.store.longitude },
  })
  const proofScore = proofMetadata.status === "PASS" ? 1 : 0.55
  const combinedQualityScore = Math.min(qualityCheck.score, proofScore)
  const combinedQualityStatus = combinedQualityScore >= 0.8 ? "GOOD" : combinedQualityScore >= 0.5 ? "REVIEW" : "POOR"
  const framePlan =
    uploadType.mediaType === "video" && parsed.data.durationMs != null
      ? selectProofVideoFrameTimestamps({ durationMs: parsed.data.durationMs, maxFrames: 3 })
      : null
  const qualityDetails: JsonObject = {
    status: combinedQualityStatus,
    score: combinedQualityScore,
    mediaType: uploadType.mediaType,
    durationMs: parsed.data.durationMs ?? null,
    mediaStatus: qualityCheck.status,
    mediaScore: qualityCheck.score,
    imageStatus: qualityCheck.status,
    imageScore: qualityCheck.score,
    dimensions: qualityCheck.dimensions
      ? { width: qualityCheck.dimensions.width, height: qualityCheck.dimensions.height }
      : null,
    framePlan: framePlan as unknown as JsonValue,
    issues: qualityCheck.issues,
    proofMetadata: proofMetadata as unknown as JsonObject,
    checkedAt: new Date().toISOString(),
  }
  const exifWithQuality: JsonObject = {
    ...asJsonObject(exif),
    qualityCheck: qualityDetails,
  }

  const { photo, reviewId, queuedVisionReviewId } = await workerDb.$transaction(async (tx) => {
    const photo = await tx.photoSubmission.create({
      data: {
        organizationId: session.org,
        storeId: task.storeId,
        taskId: task.id,
        userId: session.sub,
        url: key,
        mediaType: uploadType.mediaType === "video" ? "VIDEO" : "PHOTO",
        mimeType: file.type,
        fileSizeBytes: file.size,
        durationMs: parsed.data.durationMs ?? null,
        captureScenarioId: captureStep?.scenarioId ?? proofMetadata.capture.scenarioId,
        captureStepId: captureStep?.stepId ?? proofMetadata.capture.stepId,
        captureStepKind: captureStep?.stepKind ?? proofMetadata.capture.stepKind,
        captureStepSequence: captureStep?.sequence ?? null,
        captureRequired: captureStep?.required ?? proofMetadata.capture.required,
        captureMediaKind: captureStep?.mediaKind ?? proofMetadata.capture.mediaKind,
        captureMinDurationSeconds: captureStep?.minDurationSeconds ?? null,
        captureMaxDurationSeconds: captureStep?.maxDurationSeconds ?? null,
        clientPhotoId: parsed.data.clientPhotoId,
        takenAt: new Date(parsed.data.takenAt),
        exif: exifWithQuality,
        qualityScore: combinedQualityScore,
      },
    })
    const qualityReview =
      combinedQualityStatus === "GOOD" && proofMetadata.status === "PASS"
        ? null
        : await tx.humanReview.create({
            data: {
              organizationId: session.org,
              reason: "PHOTO_QUALITY",
              taskId: task.id,
              photoSubmissionId: photo.id,
              score: combinedQualityScore,
              findings: { qualityCheck: exifWithQuality.qualityCheck },
            },
            select: { id: true },
          })
    const queuedVisionReview =
      uploadType.mediaType === "video"
        ? await tx.humanReview.create({
            data: {
              organizationId: session.org,
              reason: "VISION_COMPLIANCE",
              status: "PENDING",
              taskId: task.id,
              photoSubmissionId: photo.id,
              planogramVersionId: task.planogramVersionId,
              findings: {
                vision: {
                  workerStatus: "queued",
                  mediaType: "video",
                  framePlan: framePlan as unknown as JsonValue,
                  queuedAt: new Date().toISOString(),
                  warnings: ["video_waiting_frame_extraction"],
                },
              },
              note: "Video proof queued for frame extraction and selected-frame AI analysis.",
            },
            select: { id: true },
          })
        : null
    return { photo, reviewId: qualityReview?.id ?? null, queuedVisionReviewId: queuedVisionReview?.id ?? null }
  })
  const visionResult =
    uploadType.mediaType === "photo"
      ? await runVisionComplianceForPhoto({
          organizationId: session.org,
          photoSubmissionId: photo.id,
        }).catch((error: unknown) =>
          skippedVision(error instanceof Error ? error.message : "vision_scan_failed"),
        )
      : skippedVision("vision_queued_frame_extraction")
  if (uploadType.mediaType === "photo") await markPhotoVisionAnalysis(photo.id, visionResult)
  return NextResponse.json(
    {
      photoId: photo.id,
      key,
      mediaType: uploadType.mediaType,
      durationMs: parsed.data.durationMs ?? null,
      analysisStatus: uploadType.mediaType === "video" ? "PENDING" : visionAnalysisPatch(visionResult).analysisStatus,
      qualityScore: combinedQualityScore,
      qualityCheck: exifWithQuality.qualityCheck,
      reviewId,
      visionReviewId: "reviewId" in visionResult ? visionResult.reviewId : queuedVisionReviewId,
      visionStatus: uploadType.mediaType === "video" ? "queued" : visionResult.status,
      visionReason: "reason" in visionResult ? visionResult.reason : null,
    },
    { status: 201 },
  )
}
