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
import { protocolMismatchFromHeader } from "@/server/mobile/protocol"
import { emitProductEvent, resolveCaptureRetakesForStep } from "@leadshelf/db"
import { workerDb } from "@/server/db/client"
import { putObject } from "@/server/storage/s3"

export type MobilePhotoSession = {
  org: string
  sub: string
  did: string
  role: string
}

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

// Guided Capture (docs/24): флаги/телеметрия — свободный JSON-объект от
// приложения; кривой JSON отклоняем, чтобы mismatch-флаг не терялся молча.
function parseJsonObjectField(raw: string | undefined): JsonObject | null | "invalid" {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : "invalid"
  } catch {
    return "invalid"
  }
}

async function ensureQueuedVisionReview(input: {
  organizationId: string
  taskId: string | null
  photoSubmissionId: string
  planogramVersionId: string | null
  mediaType: "photo" | "video"
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
          mediaType: input.mediaType,
          framePlan: input.framePlan ?? null,
          queuedAt: new Date().toISOString(),
          warnings: ["proof_waiting_analysis_worker"],
        },
      },
      note: "Proof queued for persist-first shelf analysis worker.",
    },
    select: { id: true },
  })
  return review.id
}

export async function handleMobilePhotoUpload(req: NextRequest, session: MobilePhotoSession) {
  // multipart-путь несёт протокол заголовком (docs/18/26): incompatible -> 426
  const mismatch = protocolMismatchFromHeader(req)
  if (mismatch) return mismatch

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
    captureFlagsJson: form!.get("captureFlagsJson") ?? undefined,
    captureTelemetryJson: form!.get("captureTelemetryJson") ?? undefined,
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
  const captureFlags = parseJsonObjectField(parsed.data.captureFlagsJson)
  if (captureFlags === "invalid") {
    return NextResponse.json({ error: "invalid_capture_flags" }, { status: 400 })
  }
  const captureTelemetry = parseJsonObjectField(parsed.data.captureTelemetryJson)
  if (captureTelemetry === "invalid") {
    return NextResponse.json({ error: "invalid_capture_telemetry" }, { status: 400 })
  }
  const equipmentMismatch = captureFlags?.equipmentMismatch === true

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
    const queuedVisionReviewId = await ensureQueuedVisionReview({
      organizationId: session.org,
      taskId: existing.taskId,
      photoSubmissionId: existing.id,
      planogramVersionId: existing.task?.planogramVersionId ?? null,
      mediaType: existingMediaType,
      framePlan: asObjectRecord(existingExif.qualityCheck).framePlan ?? null,
    })
    return NextResponse.json({
      photoId: existing.id,
      key: existing.url,
      mediaType: existingMediaType,
      durationMs: existing.durationMs,
      analysisStatus: existing.analysisStatus,
      qualityScore: existing.qualityScore,
      qualityCheck: existingExif.qualityCheck ?? null,
      deduplicated: true,
      visionReviewId: queuedVisionReviewId,
      visionStatus: existing.analysisStatus === "PENDING" ? "queued" : existing.analysisStatus.toLowerCase(),
      visionReason: null,
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
        captureFlags: captureFlags ?? undefined,
        captureTelemetry: captureTelemetry ?? undefined,
        qualityScore: combinedQualityScore,
      },
    })
    // equipmentMismatch всегда получает human review: полка снята «как есть»
    // и офис должен увидеть расхождение с базой оборудования (docs/24).
    const qualityReview =
      combinedQualityStatus === "GOOD" && proofMetadata.status === "PASS" && !equipmentMismatch
        ? null
        : await tx.humanReview.create({
            data: {
              organizationId: session.org,
              reason: "PHOTO_QUALITY",
              taskId: task.id,
              photoSubmissionId: photo.id,
              score: combinedQualityScore,
              findings: {
                qualityCheck: exifWithQuality.qualityCheck,
                ...(captureFlags ? { captureFlags } : {}),
              },
              ...(equipmentMismatch
                ? { note: "Field agent flagged that the physical equipment does not match the planned one." }
                : {}),
            },
            select: { id: true },
          })
    const queuedVisionReview = await tx.humanReview.create({
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
            mediaType: uploadType.mediaType,
            framePlan: framePlan as unknown as JsonValue,
            queuedAt: new Date().toISOString(),
            warnings: ["proof_waiting_analysis_worker"],
          },
        },
        note: "Proof queued for persist-first shelf analysis worker.",
      },
      select: { id: true },
    })
    return { photo, reviewId: qualityReview?.id ?? null, queuedVisionReviewId: queuedVisionReview?.id ?? null }
  })
  // Новое фото шага закрывает открытый запрос пересъемки офиса (docs/23).
  const submittedStepId = captureStep?.stepId ?? proofMetadata.capture.stepId
  if (submittedStepId) {
    await resolveCaptureRetakesForStep(workerDb, session.org, task.id, submittedStepId).catch(() => {
      // best effort: фото сохранено, запрос закроется при следующей загрузке
    })
  }
  if (equipmentMismatch) {
    await emitProductEvent(workerDb, session.org, {
      kind: "capture.equipment_mismatch",
      severity: "warning",
      storeId: task.storeId,
      entityType: "photo_submission",
      entityId: photo.id,
      dedupeKey: `capture.equipment_mismatch:${task.id}`,
      payload: {
        title: "Оборудование в точке не совпадает с базой",
        taskId: task.id,
        photoSubmissionId: photo.id,
        captureStepId: captureStep?.stepId ?? null,
      },
    }).catch(() => {
      // событие — best effort: фото уже сохранено, флаг лежит на нем
    })
  }
  return NextResponse.json(
    {
      photoId: photo.id,
      key,
      mediaType: uploadType.mediaType,
      durationMs: parsed.data.durationMs ?? null,
      analysisStatus: "PENDING",
      qualityScore: combinedQualityScore,
      qualityCheck: exifWithQuality.qualityCheck,
      reviewId,
      visionReviewId: queuedVisionReviewId,
      visionStatus: "queued",
      visionReason: null,
    },
    { status: 201 },
  )
}
