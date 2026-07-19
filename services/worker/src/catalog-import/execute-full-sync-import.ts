import { Prisma, type ImportQueueJob, type PrismaClient } from "@prisma/client"
import type { RawCsvRow } from "@leadshelf/core"

import { executeProductsImport, type ProductsImportInput } from "./execute-products-import"
import { FullSyncWorkflowError, validateAttachedFullSyncApproval } from "./full-sync-workflow"

export async function executeFullSyncProductsImport(
  prisma: PrismaClient,
  input: ProductsImportInput & {
    rows: RawCsvRow[]
    job: ImportQueueJob
    approvalSecretFile: string
    now?: Date
  },
) {
  if (process.env.LEADSHELF_FULL_SYNC_ENABLED !== "true") {
    throw new FullSyncWorkflowError("job_not_waiting")
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 5))
    `)
    const validated = await validateAttachedFullSyncApproval(tx as unknown as PrismaClient, {
      job: input.job,
      rows: input.rows,
      secretFile: input.approvalSecretFile,
      now: input.now,
    })
    const summary = await executeProductsImport(tx as unknown as PrismaClient, input)
    if (summary.status !== "COMPLETED" || summary.errorRows !== 0 || summary.reconciliation.status !== "MATCH") {
      throw new FullSyncWorkflowError("manifest_mismatch")
    }

    await tx.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE "leadshelf_full_sync_active_skus" (
        "sku" TEXT PRIMARY KEY
      ) ON COMMIT DROP
    `)
    if (validated.activeSkus.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "leadshelf_full_sync_active_skus" ("sku")
        SELECT unnest(${validated.activeSkus}::text[])
      `)
    }
    const deactivatedRows = await tx.$executeRaw(Prisma.sql`
      UPDATE "products" AS product
      SET "isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
      WHERE product."organizationId" = ${input.organizationId}
        AND product."isActive" = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM "leadshelf_full_sync_active_skus" incoming
          WHERE incoming."sku" = product."sku"
        )
    `)
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.createdById ?? null,
        action: "catalog.full_sync_applied",
        entityType: "importBatch",
        entityId: summary.batchId,
        payload: {
          changeId: validated.approval.changeId,
          requesterApprovalId: validated.approval.requesterApprovalId,
          reviewerApprovalId: validated.approval.reviewerApprovalId,
          reasonCode: validated.approval.reasonCode,
          sourceChecksum: validated.sourceChecksum,
          currentActiveRows: validated.currentActiveRows,
          currentActiveChecksum: validated.currentActiveChecksum,
          incomingActiveRows: validated.incomingActiveRows,
          deactivatedRows,
        },
      },
    })
    return { ...summary, deactivatedRows, changeId: validated.approval.changeId }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 30_000,
    timeout: 600_000,
  })
}
