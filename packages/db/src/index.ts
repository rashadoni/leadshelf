// Route handlers импортируют ТОЛЬКО createTenantClient.
// PrismaClient намеренно не реэкспортируется — worker/seed берут
// createSystemClient с обязательной причиной.
export { Prisma } from "@prisma/client"
export {
  createTenantClient,
  createSystemClient,
  TENANT_MODELS,
  type TenantClient,
} from "./tenant-client.ts"
export { listImportErrorsForBatch } from "./repos/import.ts"
export {
  createTemplateWithVersion,
  saveVersion,
  copyTemplate,
  renameTemplate,
  EquipmentRepoError,
} from "./repos/equipment.ts"
export {
  createPlanogramFromTemplate,
  getPlanogramEditor,
  addPlacement,
  updatePlacement,
  removePlacement,
  PlanogramRepoError,
} from "./repos/planogram.ts"
export {
  publishPlanogramVersion,
  createNextDraft,
  transitionTaskStatus,
  expireOverdueTasks,
  getTaskSlaSummary,
  type PublishTarget,
} from "./repos/publish.ts"
export {
  pullChanges,
  pushOperations,
  ackCursors,
  storedCursors,
  encodeCursor,
  decodeCursor,
  type PushOperation,
  type PushResult,
} from "./repos/mobile-sync.ts"
export { createOrder, OrderRepoError, type CreateOrderInput, type OrderSummary } from "./repos/orders.ts"
export {
  CommercialRepoError,
  enrollPromotion,
  submitPromotionExecution,
  recordPromoInventoryEvent,
  createSalesReturn,
  createRewardClaim,
  getAgentCommercialSnapshot,
  emptyAgentCommercialSnapshot,
  type PromotionEnrollInput,
  type PromotionSubmitInput,
  type PromoInventoryRecordInput,
  type SalesReturnCreateInput,
  type RewardClaimCreateInput,
} from "./repos/commercial.ts"
export {
  getMobileExecutionHealth,
  buildMobileExecutionHealth,
  type MobileExecutionHealth,
} from "./repos/mobile-observability.ts"
export {
  requestCaptureRetake,
  resolveCaptureRetakesForStep,
  listOpenCaptureRetakes,
  CaptureRepoError,
  type OpenCaptureRetake,
} from "./repos/capture.ts"
export {
  decideHumanReview,
  ReviewRepoError,
  type HumanReviewDecision,
} from "./repos/reviews.ts"
export {
  startShelfAnalysisRun,
  finishShelfAnalysisRun,
  readLatestShelfAnalysis,
  saveManualShelfAnalysis,
  ShelfAnalysisRepoError,
  type StartShelfAnalysisRunInput,
  type FinishShelfAnalysisRunInput,
  type LatestShelfAnalysis,
  type ManualShelfAnnotationInput,
} from "./repos/shelf-analysis.ts"
export {
  persistShelfMetricSnapshot,
  buildShelfAnalytics,
  getShelfAnalytics,
  type ShelfAnalyticsRow,
  type ShelfAnalyticsSummary,
} from "./repos/shelf-analytics.ts"
export {
  AlertRepoError,
  emitProductEvent,
  buildOfficeMorningDigest,
  enqueueOfficeMorningDigest,
  claimPendingNotificationDeliveries,
  markNotificationDeliverySent,
  markNotificationDeliveryFailed,
  detectStockGapAlerts,
  type NotificationDeliveryJob,
  type EmitProductEventInput,
} from "./repos/alerts.ts"
