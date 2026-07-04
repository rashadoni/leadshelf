CREATE TYPE "HumanReviewReason" AS ENUM ('PHOTO_QUALITY', 'VISION_COMPLIANCE');
CREATE TYPE "HumanReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "human_reviews" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reason" "HumanReviewReason" NOT NULL,
  "status" "HumanReviewStatus" NOT NULL DEFAULT 'PENDING',
  "taskId" TEXT,
  "photoSubmissionId" TEXT,
  "planogramVersionId" TEXT,
  "goldenReferenceId" TEXT,
  "score" DOUBLE PRECISION,
  "findings" JSONB,
  "note" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "human_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "human_reviews_organizationId_status_createdAt_idx"
  ON "human_reviews"("organizationId", "status", "createdAt");
CREATE INDEX "human_reviews_taskId_idx" ON "human_reviews"("taskId");
CREATE INDEX "human_reviews_photoSubmissionId_idx" ON "human_reviews"("photoSubmissionId");
CREATE INDEX "human_reviews_planogramVersionId_idx" ON "human_reviews"("planogramVersionId");

ALTER TABLE "human_reviews"
  ADD CONSTRAINT "human_reviews_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "human_reviews"
  ADD CONSTRAINT "human_reviews_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "human_reviews"
  ADD CONSTRAINT "human_reviews_photoSubmissionId_fkey"
  FOREIGN KEY ("photoSubmissionId") REFERENCES "photo_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "human_reviews"
  ADD CONSTRAINT "human_reviews_planogramVersionId_fkey"
  FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "human_reviews"
  ADD CONSTRAINT "human_reviews_goldenReferenceId_fkey"
  FOREIGN KEY ("goldenReferenceId") REFERENCES "golden_references"("id") ON DELETE SET NULL ON UPDATE CASCADE;
