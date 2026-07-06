CREATE TYPE "ProofAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED');

ALTER TABLE "photo_submissions"
  ADD COLUMN "analysisStatus" "ProofAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "analysisAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "analysisProvider" TEXT,
  ADD COLUMN "analysisModelVersion" TEXT,
  ADD COLUMN "analysisError" TEXT,
  ADD COLUMN "analysisStartedAt" TIMESTAMP(3),
  ADD COLUMN "analysisFinishedAt" TIMESTAMP(3);

CREATE INDEX "photo_submissions_analysis_idx"
  ON "photo_submissions" ("organizationId", "mediaType", "analysisStatus", "createdAt");
