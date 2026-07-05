import { z } from "zod"
import { orderCreateRequestSchema } from "../../orders/v1"

export const MOBILE_PROTOCOL_VERSION = 1 as const

export const mobileProtocolVersionSchema = z.number().int()

export const mobileDeviceSchema = z.object({
  id: z.string().min(8).max(128),
  platform: z.string().min(1).max(32),
  deviceName: z.string().max(128).optional(),
  pushToken: z.string().max(512).optional(),
})
export type MobileDevice = z.infer<typeof mobileDeviceSchema>

export const mobileLoginRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  orgSlug: z.string().trim().min(1),
  employeeCode: z.string().trim().min(1).max(64),
  pin: z.string().min(1).max(64),
  device: mobileDeviceSchema,
})
export type MobileLoginRequest = z.infer<typeof mobileLoginRequestSchema>

export const mobileTokenPairSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
})
export type MobileTokenPair = z.infer<typeof mobileTokenPairSchema>

export const mobileLoginResponseSchema = z.object({
  user: z.object({
    id: z.string().optional(),
    name: z.string(),
    role: z.string().optional(),
    employeeCode: z.string().nullable().optional(),
  }),
  tokens: mobileTokenPairSchema,
})
export type MobileLoginResponse = z.infer<typeof mobileLoginResponseSchema>

export const mobileRefreshRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  refreshToken: z.string().min(10),
  deviceId: z.string().min(8),
})
export type MobileRefreshRequest = z.infer<typeof mobileRefreshRequestSchema>

export const mobileSyncCursorsSchema = z.object({
  tasks: z.string().nullable().optional(),
  planogramBundles: z.string().nullable().optional(),
  routes: z.string().nullable().optional(),
  visits: z.string().nullable().optional(),
  photoSubmissions: z.string().nullable().optional(),
})
export type MobileSyncCursors = z.infer<typeof mobileSyncCursorsSchema>

export const mobileTaskStatusSchema = z.enum([
  "NEW",
  "IN_PROGRESS",
  "PHOTO_SUBMITTED",
  "COMPLETED",
  "EXPIRED",
  "EMPTY",
])
export type MobileTaskStatus = z.infer<typeof mobileTaskStatusSchema>

export const mobileTaskLocationHintSchema = z.object({
  source: z.enum(["STORE_FLOOR_PLAN", "FORMAT_FLOOR_PLAN"]),
  floorPlanName: z.string().nullable(),
  label: z.string().nullable(),
  equipmentName: z.string().nullable(),
  xMm: z.number().int().nullable(),
  yMm: z.number().int().nullable(),
  rotationDeg: z.number().int().nullable(),
})
export type MobileTaskLocationHint = z.infer<typeof mobileTaskLocationHintSchema>

export const mobileTaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: mobileTaskStatusSchema,
  dueAt: z.string().nullable(),
  storeId: z.string(),
  planogramVersionId: z.string().nullable(),
  locationHint: mobileTaskLocationHintSchema.nullable().optional(),
  updatedAt: z.string(),
})
export type MobileTaskRow = z.infer<typeof mobileTaskRowSchema>

export const mobileStoreRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})
export type MobileStoreRow = z.infer<typeof mobileStoreRowSchema>

export const mobileRouteStopRowSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  storeId: z.string(),
  sortOrder: z.number().int(),
  plannedAt: z.string().nullable(),
})
export type MobileRouteStopRow = z.infer<typeof mobileRouteStopRowSchema>

export const mobileRouteRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
  stops: z.array(mobileRouteStopRowSchema),
})
export type MobileRouteRow = z.infer<typeof mobileRouteRowSchema>

export const mobileVisitStatusSchema = z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED"])
export type MobileVisitStatus = z.infer<typeof mobileVisitStatusSchema>

export const mobileVisitRowSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  storeId: z.string(),
  routeStopId: z.string().nullable(),
  status: mobileVisitStatusSchema,
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  anomalyFlags: z.unknown().nullable(),
  updatedAt: z.string(),
})
export type MobileVisitRow = z.infer<typeof mobileVisitRowSchema>

export const mobilePlanogramBundleSchema = z
  .object({
    versionId: z.string(),
  })
  .passthrough()
export type MobilePlanogramBundle = z.infer<typeof mobilePlanogramBundleSchema>

export const mobileHumanReviewStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"])
export type MobileHumanReviewStatus = z.infer<typeof mobileHumanReviewStatusSchema>

export const mobilePhotoSubmissionReviewSchema = z.object({
  id: z.string(),
  reason: z.enum(["PHOTO_QUALITY", "VISION_COMPLIANCE"]),
  status: mobileHumanReviewStatusSchema,
  score: z.number().nullable(),
  note: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  updatedAt: z.string(),
})
export type MobilePhotoSubmissionReview = z.infer<typeof mobilePhotoSubmissionReviewSchema>

export const mobilePhotoSubmissionRowSchema = z.object({
  id: z.string(),
  clientPhotoId: z.string().nullable(),
  taskId: z.string(),
  storeId: z.string(),
  key: z.string(),
  takenAt: z.string(),
  qualityScore: z.number().nullable(),
  review: mobilePhotoSubmissionReviewSchema.nullable(),
  vision: mobilePhotoSubmissionReviewSchema.nullable(),
  updatedAt: z.string(),
})
export type MobilePhotoSubmissionRow = z.infer<typeof mobilePhotoSubmissionRowSchema>

export const mobileSyncPullRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  cursors: mobileSyncCursorsSchema.default({}),
})
export type MobileSyncPullRequest = z.infer<typeof mobileSyncPullRequestSchema>

export const mobileSyncPullResponseSchema = z.object({
  tasks: z.array(mobileTaskRowSchema),
  stores: z.array(mobileStoreRowSchema),
  routes: z.array(mobileRouteRowSchema).default([]),
  visits: z.array(mobileVisitRowSchema).default([]),
  photoSubmissions: z.array(mobilePhotoSubmissionRowSchema).default([]),
  planogramBundles: z.array(mobilePlanogramBundleSchema),
  cursors: z.object({
    tasks: z.string().nullable(),
    planogramBundles: z.string().nullable(),
    routes: z.string().nullable().optional(),
    visits: z.string().nullable().optional(),
    photoSubmissions: z.string().nullable().optional(),
  }),
})
export type MobileSyncPullResponse = z.infer<typeof mobileSyncPullResponseSchema>

export const mobileTaskStatusPayloadSchema = z.object({
  taskId: z.string().min(1),
  expectedStatus: mobileTaskStatusSchema,
  toStatus: mobileTaskStatusSchema,
})
export type MobileTaskStatusPayload = z.infer<typeof mobileTaskStatusPayloadSchema>

export const mobilePhotoSubmitPayloadSchema = z.object({
  clientPhotoId: z.string().min(8).max(128),
  taskId: z.string().min(1),
  expectedTaskStatus: mobileTaskStatusSchema.optional(),
})
export type MobilePhotoSubmitPayload = z.infer<typeof mobilePhotoSubmitPayloadSchema>

export const mobileTaskCommentPayloadSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
})
export type MobileTaskCommentPayload = z.infer<typeof mobileTaskCommentPayloadSchema>

export const mobileVisitCheckInPayloadSchema = z.object({
  agentId: z.string().min(1),
  storeId: z.string().min(1),
  routeStopId: z.string().min(1).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceLimitM: z.number().int().min(25).max(2000).optional(),
})
export type MobileVisitCheckInPayload = z.infer<typeof mobileVisitCheckInPayloadSchema>

export const mobileVisitCheckOutPayloadSchema = z.object({
  visitId: z.string().min(1),
})
export type MobileVisitCheckOutPayload = z.infer<typeof mobileVisitCheckOutPayloadSchema>

export const mobileLocationUpdatePayloadSchema = z.object({
  agentId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(5000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
})
export type MobileLocationUpdatePayload = z.infer<typeof mobileLocationUpdatePayloadSchema>

export const mobilePushOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("task.status"),
    payload: mobileTaskStatusPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("photo.submit"),
    payload: mobilePhotoSubmitPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("task.comment"),
    payload: mobileTaskCommentPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("visit.checkin"),
    payload: mobileVisitCheckInPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("visit.checkout"),
    payload: mobileVisitCheckOutPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("location.update"),
    payload: mobileLocationUpdatePayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("order.create"),
    payload: orderCreateRequestSchema,
    clientCreatedAt: z.string().optional(),
  }),
])
export type MobilePushOperation = z.infer<typeof mobilePushOperationSchema>

export const mobileSyncPushRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  operations: z.array(mobilePushOperationSchema).min(1).max(100),
})
export type MobileSyncPushRequest = z.infer<typeof mobileSyncPushRequestSchema>

export const mobilePushResultSchema = z.object({
  clientOpId: z.string(),
  status: z.enum(["applied", "already_applied", "conflict", "rejected"]),
  detail: z.unknown().optional(),
})
export type MobilePushResult = z.infer<typeof mobilePushResultSchema>

export const mobileSyncPushResponseSchema = z.object({
  results: z.array(mobilePushResultSchema),
})
export type MobileSyncPushResponse = z.infer<typeof mobileSyncPushResponseSchema>

export const mobileSyncAckRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  appliedCursors: z.record(z.string(), z.string()),
})
export type MobileSyncAckRequest = z.infer<typeof mobileSyncAckRequestSchema>

export const mobilePhotoUploadFieldsSchema = z.object({
  clientPhotoId: z.string().min(8).max(128),
  taskId: z.string().min(1),
  takenAt: z.string().datetime(),
  exifJson: z.string().max(20000).optional(),
})
export type MobilePhotoUploadFields = z.infer<typeof mobilePhotoUploadFieldsSchema>

export const mobilePhotoUploadResponseSchema = z.object({
  photoId: z.string(),
  key: z.string(),
  qualityScore: z.number().nullable().optional(),
  qualityCheck: z.unknown().nullable().optional(),
  reviewId: z.string().nullable().optional(),
  deduplicated: z.boolean().optional(),
  visionReviewId: z.string().nullable().optional(),
  visionStatus: z.string().nullable().optional(),
  visionReason: z.string().nullable().optional(),
})
export type MobilePhotoUploadResponse = z.infer<typeof mobilePhotoUploadResponseSchema>
