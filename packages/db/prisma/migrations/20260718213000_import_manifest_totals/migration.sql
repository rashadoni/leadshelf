ALTER TABLE "import_queue_jobs"
  ADD COLUMN "expectedRows" INTEGER,
  ADD COLUMN "expectedChecksum" TEXT,
  ADD COLUMN "expectedTotals" JSONB;

ALTER TABLE "import_queue_jobs"
  ADD CONSTRAINT "import_queue_jobs_expectedRows_nonnegative"
  CHECK ("expectedRows" IS NULL OR "expectedRows" >= 0);
