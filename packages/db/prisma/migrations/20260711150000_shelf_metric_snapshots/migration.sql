CREATE TABLE "shelf_metric_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "analysisRunId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "taskId" TEXT,
  "planogramVersionId" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "structuralScore" DOUBLE PRECISION,
  "visualConfidence" DOUBLE PRECISION,
  "oosCount" INTEGER NOT NULL DEFAULT 0,
  "expectedFacings" INTEGER NOT NULL DEFAULT 0,
  "actualFacings" INTEGER,
  "actionCount" INTEGER NOT NULL DEFAULT 0,
  "share" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shelf_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shelf_metric_snapshots_analysisRunId_key" ON "shelf_metric_snapshots"("analysisRunId");
CREATE INDEX "shelf_metric_snapshots_organizationId_capturedAt_idx" ON "shelf_metric_snapshots"("organizationId", "capturedAt");
CREATE INDEX "shelf_metric_snapshots_organizationId_storeId_capturedAt_idx" ON "shelf_metric_snapshots"("organizationId", "storeId", "capturedAt");
CREATE INDEX "shelf_metric_snapshots_organizationId_agentId_capturedAt_idx" ON "shelf_metric_snapshots"("organizationId", "agentId", "capturedAt");
CREATE INDEX "shelf_metric_snapshots_organizationId_planogramVersionId_c_idx" ON "shelf_metric_snapshots"("organizationId", "planogramVersionId", "capturedAt");
CREATE INDEX "shelf_metric_snapshots_organizationId_status_capturedAt_idx" ON "shelf_metric_snapshots"("organizationId", "status", "capturedAt");

ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_analysisRunId_fkey"
  FOREIGN KEY ("analysisRunId") REFERENCES "shelf_analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shelf_metric_snapshots" ADD CONSTRAINT "shelf_metric_snapshots_planogramVersionId_fkey"
  FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
