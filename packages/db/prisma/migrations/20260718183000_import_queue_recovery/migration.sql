-- Retry scheduling and efficient global worker polling.
ALTER TABLE "import_queue_jobs"
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "import_queue_jobs_status_availableAt_createdAt_idx"
  ON "import_queue_jobs"("status", "availableAt", "createdAt");
