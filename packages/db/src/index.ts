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
  type PublishTarget,
} from "./repos/publish.ts"
