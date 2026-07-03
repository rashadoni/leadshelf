import { z } from "zod"

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

export const mobileTaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: mobileTaskStatusSchema,
  dueAt: z.string().nullable(),
  storeId: z.string(),
  planogramVersionId: z.string().nullable(),
  updatedAt: z.string(),
})
export type MobileTaskRow = z.infer<typeof mobileTaskRowSchema>

export const mobileStoreRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
})
export type MobileStoreRow = z.infer<typeof mobileStoreRowSchema>

export const mobilePlanogramBundleSchema = z
  .object({
    versionId: z.string(),
  })
  .passthrough()
export type MobilePlanogramBundle = z.infer<typeof mobilePlanogramBundleSchema>

export const mobileSyncPullRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  cursors: mobileSyncCursorsSchema.default({}),
})
export type MobileSyncPullRequest = z.infer<typeof mobileSyncPullRequestSchema>

export const mobileSyncPullResponseSchema = z.object({
  tasks: z.array(mobileTaskRowSchema),
  stores: z.array(mobileStoreRowSchema),
  planogramBundles: z.array(mobilePlanogramBundleSchema),
  cursors: z.object({
    tasks: z.string().nullable(),
    planogramBundles: z.string().nullable(),
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
