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

// Guided Capture (docs/24 slice 1): сценарий съемки, резолвится сервером
// по типу оборудования планограммы и приходит снапшотом на task row.
// Все изменения аддитивны: старое приложение просто не видит поле.
export const mobileProofMediaKindSchema = z.enum(["photo", "video"])

export const mobileCaptureDepthModeSchema = z.enum([
  "angle_photo",
  "manual_attestation",
  "stock_triangulation",
])
export type MobileCaptureDepthMode = z.infer<typeof mobileCaptureDepthModeSchema>

export const mobileCaptureTemplateStepSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  required: z.boolean(),
  sequence: z.number().int().min(0).max(100),
  mediaKind: mobileProofMediaKindSchema.default("photo"),
  burstCount: z.number().int().min(1).max(5).nullable().optional(),
  tiltToleranceDeg: z.number().int().min(1).max(45).nullable().optional(),
  compositionHint: z.string().max(64).nullable().optional(),
  doorPolicy: z.enum(["open_allowed", "open_forbidden"]).nullable().optional(),
  depthMode: mobileCaptureDepthModeSchema.nullable().optional(),
  minDurationSeconds: z.number().int().min(0).max(120).nullable().optional(),
  maxDurationSeconds: z.number().int().min(0).max(120).nullable().optional(),
  titleOverrides: z.record(z.string(), z.string().max(200)).nullable().optional(),
  instructionOverrides: z.record(z.string(), z.string().max(500)).nullable().optional(),
})
export type MobileCaptureTemplateStep = z.infer<typeof mobileCaptureTemplateStepSchema>

export const mobileCaptureTemplateSchema = z.object({
  id: z.string().min(1),
  scenarioId: z.string().min(1).max(128),
  name: z.string(),
  equipmentKind: z.string().nullable().optional(),
  version: z.number().int().min(1),
  steps: z.array(mobileCaptureTemplateStepSchema).min(1).max(12),
  updatedAt: z.string(),
})
export type MobileCaptureTemplate = z.infer<typeof mobileCaptureTemplateSchema>

// Открытый запрос офиса переснять шаг (docs/23). requestedAt позволяет
// приложению отличить старое фото шага от свежей пересъемки.
export const mobileCaptureRetakeSchema = z.object({
  stepId: z.string().min(1).max(64),
  stepKind: z.string().max(64).nullable().optional(),
  note: z.string().nullable().optional(),
  requestedAt: z.string(),
})
export type MobileCaptureRetake = z.infer<typeof mobileCaptureRetakeSchema>

export const mobileTaskRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: mobileTaskStatusSchema,
  dueAt: z.string().nullable(),
  storeId: z.string(),
  planogramVersionId: z.string().nullable(),
  locationHint: mobileTaskLocationHintSchema.nullable().optional(),
  captureTemplate: mobileCaptureTemplateSchema.nullable().optional(),
  captureRetakes: z.array(mobileCaptureRetakeSchema).optional(),
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

export const mobileProofMediaTypeSchema = z.enum(["photo", "video"])
export type MobileProofMediaType = z.infer<typeof mobileProofMediaTypeSchema>

export const mobileCaptureStepSchema = z.object({
  scenarioId: z.string().min(1).max(128),
  stepId: z.string().min(1).max(128),
  stepKind: z.string().min(1).max(64),
  required: z.boolean(),
  sequence: z.number().int().min(0).max(100),
  mediaKind: mobileProofMediaTypeSchema,
  minDurationSeconds: z.number().int().min(0).max(120).nullable().optional(),
  maxDurationSeconds: z.number().int().min(0).max(120).nullable().optional(),
})
export type MobileCaptureStep = z.infer<typeof mobileCaptureStepSchema>

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

const mobileShelfBBoxSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().positive().max(100),
  heightPct: z.number().positive().max(100),
})

export const mobileShelfComparisonResultSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(["PASS", "REVIEW", "FAIL", "UNAVAILABLE"]),
  structuralScore: z.number().min(0).max(100).nullable(),
  visualConfidence: z.number().min(0).max(1).nullable(),
  strictCompliance: z.boolean(),
  placements: z.array(z.object({
    placementId: z.string(),
    shelfId: z.string().nullable(),
    productId: z.string().nullable(),
    productSku: z.string().nullable(),
    productName: z.string(),
    brand: z.string().nullable(),
    expectedFacings: z.number().int().min(0),
    actualFacings: z.number().int().min(0).nullable(),
    outcome: z.enum(["matched", "missing", "wrong_product", "wrong_position", "facing_mismatch", "unavailable"]),
    confidence: z.number().min(0).max(1).nullable(),
    detectionIds: z.array(z.string()),
    action: z.unknown().nullable(),
  })),
  detections: z.array(z.object({
    detectionId: z.string(),
    slotId: z.string().nullable(),
    placementId: z.string().nullable(),
    shelfId: z.string().nullable(),
    productId: z.string().nullable(),
    productSku: z.string().nullable(),
    label: z.string().nullable(),
    brand: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    facings: z.number().int().min(1),
    bbox: mobileShelfBBoxSchema.nullable(),
    source: z.enum(["ai", "manual"]),
  })),
  extras: z.array(z.unknown()),
  actions: z.array(z.object({
    type: z.enum(["restock", "add_facings", "remove_facings", "move", "manual_review"]),
    placementId: z.string().nullable(),
    productId: z.string().nullable(),
    productSku: z.string().nullable(),
    amount: z.number().int().nullable(),
  })),
  metrics: z.object({
    lenientCompliance: z.number().min(0).max(100).nullable(),
    strictCompliance: z.number().min(0).max(100).nullable(),
    expectedFacings: z.number().int().min(0),
    actualFacings: z.number().int().min(0).nullable(),
    oos: z.array(z.unknown()),
    shareOfShelf: z.array(z.unknown()),
    brandShare: z.array(z.unknown()),
    ourBrandSharePct: z.number().min(0).max(100).nullable(),
    competitorSharePct: z.number().min(0).max(100).nullable(),
  }),
  warnings: z.array(z.string()),
})
export type MobileShelfComparisonResult = z.infer<typeof mobileShelfComparisonResultSchema>

export const mobilePhotoSubmissionRowSchema = z.object({
  id: z.string(),
  clientPhotoId: z.string().nullable(),
  taskId: z.string(),
  storeId: z.string(),
  key: z.string(),
  mediaType: mobileProofMediaTypeSchema.default("photo"),
  durationMs: z.number().int().nullable().optional(),
  captureStep: mobileCaptureStepSchema.nullable().optional(),
  takenAt: z.string(),
  qualityScore: z.number().nullable(),
  review: mobilePhotoSubmissionReviewSchema.nullable(),
  vision: mobilePhotoSubmissionReviewSchema.nullable(),
  comparison: mobileShelfComparisonResultSchema.nullable().optional(),
  updatedAt: z.string(),
})
export type MobilePhotoSubmissionRow = z.infer<typeof mobilePhotoSubmissionRowSchema>

export const mobileSyncPullRequestSchema = z.object({
  protocolVersion: mobileProtocolVersionSchema,
  cursors: mobileSyncCursorsSchema.default({}),
})
export type MobileSyncPullRequest = z.infer<typeof mobileSyncPullRequestSchema>

export const mobilePromotionExecutionStatusSchema = z.enum([
  "ENROLLED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
])

export const mobileCommercialSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  promotions: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.string(),
    config: z.unknown(),
    activeFrom: z.string().datetime(),
    activeTo: z.string().datetime().nullable(),
    productIds: z.array(z.string()),
  })),
  promotionExecutions: z.array(z.object({
    id: z.string().min(1),
    clientExecutionId: z.string().min(8).max(128),
    promotionId: z.string().min(1),
    storeId: z.string().min(1),
    visitId: z.string().nullable(),
    status: mobilePromotionExecutionStatusSchema,
    note: z.string().nullable(),
    proofPhotoUrl: z.string().nullable(),
    submittedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })),
  inventory: z.object({
    items: z.array(z.object({
      id: z.string().min(1),
      code: z.string(),
      name: z.string(),
      kind: z.enum(["SAMPLE", "MATERIAL"]),
      productId: z.string().nullable(),
      unit: z.string(),
      balance: z.number().finite(),
    })),
    events: z.array(z.object({
      id: z.string().min(1),
      itemId: z.string().min(1),
      eventType: z.enum(["RECEIVE", "ISSUE", "RETURN", "COUNT_ADJUSTMENT"]),
      quantityDelta: z.number().finite(),
      countedBalance: z.number().finite().nullable(),
      storeId: z.string().nullable(),
      visitId: z.string().nullable(),
      reason: z.string().nullable(),
      note: z.string().nullable(),
      recordedAt: z.string().datetime(),
    })),
  }),
  orders: z.array(z.object({
    id: z.string().min(1),
    storeId: z.string().min(1),
    storeName: z.string(),
    visitId: z.string().nullable(),
    status: z.enum(["DRAFT", "SUBMITTED", "CONFIRMED", "DELIVERED", "CANCELLED"]),
    currency: z.string(),
    subtotalAmount: z.number().finite(),
    discountAmount: z.number().finite(),
    taxAmount: z.number().finite(),
    totalAmount: z.number().finite(),
    appliedPromotions: z.unknown(),
    invoiceNumber: z.string().nullable(),
    submittedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lines: z.array(z.object({
      id: z.string().min(1),
      productId: z.string().min(1),
      productName: z.string(),
      sku: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      totalAmount: z.number().nonnegative(),
      promotionId: z.string().nullable(),
    })),
  })),
  returns: z.array(z.object({
    id: z.string().min(1),
    orderId: z.string().min(1),
    storeId: z.string().min(1),
    visitId: z.string().nullable(),
    status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "RECEIVED"]),
    reason: z.string(),
    note: z.string().nullable(),
    evidencePhotoUrl: z.string().nullable(),
    submittedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lines: z.array(z.object({
      id: z.string().min(1),
      orderLineId: z.string().min(1),
      productId: z.string().min(1),
      quantity: z.number().positive(),
      unitAmount: z.number().nonnegative(),
    })),
  })),
  rewards: z.object({
    balance: z.number().int().nonnegative(),
    catalog: z.array(z.object({
      id: z.string().min(1),
      code: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      pointsCost: z.number().int().nonnegative(),
      stockQuantity: z.number().int().nonnegative().nullable(),
      imageUrl: z.string().nullable(),
    })),
    claims: z.array(z.object({
      id: z.string().min(1),
      rewardItemId: z.string().min(1),
      status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "FULFILLED", "CANCELLED"]),
      quantity: z.number().int().positive(),
      pointsCost: z.number().int().nonnegative(),
      note: z.string().nullable(),
      submittedAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })),
    ledger: z.array(z.object({
      id: z.string().min(1),
      pointsDelta: z.number().int(),
      reason: z.string(),
      sourceType: z.string().nullable(),
      sourceId: z.string().nullable(),
      createdAt: z.string().datetime(),
    })),
  }),
})
export type MobileCommercialSnapshot = z.infer<typeof mobileCommercialSnapshotSchema>

export const EMPTY_MOBILE_COMMERCIAL_SNAPSHOT: MobileCommercialSnapshot = {
  version: 1,
  generatedAt: "1970-01-01T00:00:00.000Z",
  promotions: [],
  promotionExecutions: [],
  inventory: { items: [], events: [] },
  orders: [],
  returns: [],
  rewards: { balance: 0, catalog: [], claims: [], ledger: [] },
}

export const mobileSyncPullResponseSchema = z.object({
  tasks: z.array(mobileTaskRowSchema),
  stores: z.array(mobileStoreRowSchema),
  routes: z.array(mobileRouteRowSchema).default([]),
  visits: z.array(mobileVisitRowSchema).default([]),
  photoSubmissions: z.array(mobilePhotoSubmissionRowSchema).default([]),
  planogramBundles: z.array(mobilePlanogramBundleSchema),
  commercial: mobileCommercialSnapshotSchema.default(EMPTY_MOBILE_COMMERCIAL_SNAPSHOT),
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

// Шаг сценария физически невозможен (docs/24 manual_exception).
export const mobileProofExceptionPayloadSchema = z.object({
  taskId: z.string().min(1),
  stepId: z.string().min(1).max(64),
  stepKind: z.string().max(64).nullable().optional(),
  reason: z.enum(["no_access", "equipment_missing", "obstruction", "other"]),
  note: z.string().trim().max(500).optional(),
})
export type MobileProofExceptionPayload = z.infer<typeof mobileProofExceptionPayloadSchema>

export const mobileLocationUpdatePayloadSchema = z.object({
  agentId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(5000).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
})
export type MobileLocationUpdatePayload = z.infer<typeof mobileLocationUpdatePayloadSchema>

export const mobilePromotionEnrollPayloadSchema = z.object({
  promotionId: z.string().min(1),
  storeId: z.string().min(1),
  visitId: z.string().min(1).nullable().optional(),
  clientExecutionId: z.string().min(8).max(128),
  note: z.string().trim().max(1000).nullable().optional(),
})
export type MobilePromotionEnrollPayload = z.infer<typeof mobilePromotionEnrollPayloadSchema>

export const mobilePromotionSubmitPayloadSchema = z.object({
  clientExecutionId: z.string().min(8).max(128),
  note: z.string().trim().max(1000).nullable().optional(),
  proofPhotoUrl: z.string().trim().max(2048).nullable().optional(),
}).refine((value) => Boolean(value.note || value.proofPhotoUrl), {
  message: "promotion proof requires note or photo",
})
export type MobilePromotionSubmitPayload = z.infer<typeof mobilePromotionSubmitPayloadSchema>

export const mobilePromoInventoryRecordPayloadSchema = z.object({
  itemId: z.string().min(1),
  eventType: z.enum(["RECEIVE", "ISSUE", "RETURN", "COUNT_ADJUSTMENT"]),
  quantity: z.number().positive().max(1_000_000).optional(),
  countedBalance: z.number().nonnegative().max(1_000_000).optional(),
  storeId: z.string().min(1).nullable().optional(),
  visitId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  recordedAt: z.string().datetime(),
})
export type MobilePromoInventoryRecordPayload = z.infer<typeof mobilePromoInventoryRecordPayloadSchema>

export const mobileSalesReturnCreatePayloadSchema = z.object({
  orderId: z.string().min(1),
  visitId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().min(1).max(100),
  note: z.string().trim().max(1000).nullable().optional(),
  evidencePhotoUrl: z.string().trim().max(2048).nullable().optional(),
  lines: z.array(z.object({
    orderLineId: z.string().min(1),
    quantity: z.number().positive().max(1_000_000),
  })).min(1).max(200),
})
export type MobileSalesReturnCreatePayload = z.infer<typeof mobileSalesReturnCreatePayloadSchema>

export const mobileRewardClaimPayloadSchema = z.object({
  rewardItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(100),
  note: z.string().trim().max(1000).nullable().optional(),
})
export type MobileRewardClaimPayload = z.infer<typeof mobileRewardClaimPayloadSchema>

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
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("promotion.enroll"),
    payload: mobilePromotionEnrollPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("promotion.submit"),
    payload: mobilePromotionSubmitPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("inventory.record"),
    payload: mobilePromoInventoryRecordPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("return.create"),
    payload: mobileSalesReturnCreatePayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("reward.claim"),
    payload: mobileRewardClaimPayloadSchema,
    clientCreatedAt: z.string().optional(),
  }),
  z.object({
    clientOpId: z.string().min(8).max(128),
    kind: z.literal("proof.exception"),
    payload: mobileProofExceptionPayloadSchema,
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
  mediaType: mobileProofMediaTypeSchema.default("photo"),
  durationMs: z.coerce.number().int().min(0).max(120000).optional(),
  captureStepJson: z.string().max(5000).optional(),
  exifJson: z.string().max(20000).optional(),
  // Guided Capture (docs/24): флаги (equipmentMismatch и т.п.) и телеметрия
  // гида (время до принятого кадра, пересъемки, override).
  captureFlagsJson: z.string().max(2000).optional(),
  captureTelemetryJson: z.string().max(4000).optional(),
})
export type MobilePhotoUploadFields = z.infer<typeof mobilePhotoUploadFieldsSchema>

export const mobilePhotoUploadResponseSchema = z.object({
  photoId: z.string(),
  key: z.string(),
  mediaType: mobileProofMediaTypeSchema.default("photo"),
  durationMs: z.number().int().nullable().optional(),
  analysisStatus: z.enum(["PENDING", "PROCESSING", "COMPLETED", "SKIPPED", "FAILED"]).optional(),
  qualityScore: z.number().nullable().optional(),
  qualityCheck: z.unknown().nullable().optional(),
  reviewId: z.string().nullable().optional(),
  deduplicated: z.boolean().optional(),
  visionReviewId: z.string().nullable().optional(),
  visionStatus: z.string().nullable().optional(),
  visionReason: z.string().nullable().optional(),
})
export type MobilePhotoUploadResponse = z.infer<typeof mobilePhotoUploadResponseSchema>

export const mobileCommercialMediaPurposeSchema = z.enum([
  "PROMOTION_PROOF",
  "RETURN_EVIDENCE",
])
export type MobileCommercialMediaPurpose = z.infer<typeof mobileCommercialMediaPurposeSchema>

export const mobileCommercialMediaUploadFieldsSchema = z.object({
  clientMediaId: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  purpose: mobileCommercialMediaPurposeSchema,
  takenAt: z.string().datetime(),
})
export type MobileCommercialMediaUploadFields = z.infer<typeof mobileCommercialMediaUploadFieldsSchema>

export const mobileCommercialMediaUploadResponseSchema = z.object({
  mediaId: z.string().min(8).max(128),
  key: z.string().min(1).max(2048),
  purpose: mobileCommercialMediaPurposeSchema,
  deduplicated: z.boolean().optional(),
})
export type MobileCommercialMediaUploadResponse = z.infer<typeof mobileCommercialMediaUploadResponseSchema>
