-- Guided Shelf Proof media metadata.
CREATE TYPE "ProofMediaType" AS ENUM ('PHOTO', 'VIDEO');

ALTER TABLE "photo_submissions"
  ADD COLUMN "mediaType" "ProofMediaType" NOT NULL DEFAULT 'PHOTO',
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "fileSizeBytes" INTEGER,
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "captureScenarioId" TEXT,
  ADD COLUMN "captureStepId" TEXT,
  ADD COLUMN "captureStepKind" TEXT,
  ADD COLUMN "captureStepSequence" INTEGER,
  ADD COLUMN "captureRequired" BOOLEAN,
  ADD COLUMN "captureMediaKind" TEXT,
  ADD COLUMN "captureMinDurationSeconds" INTEGER,
  ADD COLUMN "captureMaxDurationSeconds" INTEGER;

CREATE INDEX "photo_submissions_taskId_captureStepId_idx"
  ON "photo_submissions"("taskId", "captureStepId");
