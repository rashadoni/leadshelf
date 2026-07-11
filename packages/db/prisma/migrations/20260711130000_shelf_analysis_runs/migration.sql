CREATE TYPE "ShelfAnalysisRunStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'REVIEW',
  'UNAVAILABLE',
  'FAILED'
);

CREATE TYPE "ShelfAnalysisRunSource" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "shelf_analysis_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "photoSubmissionId" TEXT NOT NULL,
  "taskId" TEXT,
  "planogramVersionId" TEXT,
  "goldenReferenceId" TEXT,
  "humanReviewId" TEXT,
  "source" "ShelfAnalysisRunSource" NOT NULL DEFAULT 'AUTO',
  "status" "ShelfAnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "comparisonVersion" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "input" JSONB NOT NULL,
  "result" JSONB,
  "warnings" JSONB,
  "error" TEXT,
  "latencyMs" INTEGER,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "costMicros" INTEGER,
  "isCanonical" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shelf_analysis_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shelf_analysis_runs_organizationId_idempotencyKey_key"
  ON "shelf_analysis_runs"("organizationId", "idempotencyKey");
CREATE INDEX "shelf_analysis_runs_organizationId_photoSubmissionId_isCan_idx"
  ON "shelf_analysis_runs"("organizationId", "photoSubmissionId", "isCanonical", "createdAt");
CREATE INDEX "shelf_analysis_runs_organizationId_planogramVersionId_status_idx"
  ON "shelf_analysis_runs"("organizationId", "planogramVersionId", "status", "createdAt");
CREATE INDEX "shelf_analysis_runs_organizationId_inputHash_provider_modelVer_idx"
  ON "shelf_analysis_runs"("organizationId", "inputHash", "provider", "modelVersion");

ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_photoSubmissionId_fkey"
  FOREIGN KEY ("photoSubmissionId") REFERENCES "photo_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_planogramVersionId_fkey"
  FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_goldenReferenceId_fkey"
  FOREIGN KEY ("goldenReferenceId") REFERENCES "golden_references"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shelf_analysis_runs"
  ADD CONSTRAINT "shelf_analysis_runs_humanReviewId_fkey"
  FOREIGN KEY ("humanReviewId") REFERENCES "human_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
