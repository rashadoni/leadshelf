-- Operational metrics query recent terminal failures and the oldest active work.
-- Partial indexes keep frequent Prometheus scrapes bounded as tables grow.
CREATE INDEX "outbox_operations_failed_processedAt_idx"
  ON "outbox_operations" ("processedAt")
  WHERE "status" = 'FAILED';

CREATE INDEX "import_queue_jobs_failed_finishedAt_idx"
  ON "import_queue_jobs" ("finishedAt")
  WHERE "status" = 'FAILED';

CREATE INDEX "photo_submissions_failed_analysisFinishedAt_idx"
  ON "photo_submissions" ("analysisFinishedAt")
  WHERE "analysisStatus" = 'FAILED';

CREATE INDEX "notification_deliveries_failed_finishedAt_idx"
  ON "notification_deliveries" ("finishedAt")
  WHERE "status" = 'FAILED';

CREATE INDEX "photo_submissions_pending_analysis_createdAt_idx"
  ON "photo_submissions" ("createdAt")
  WHERE "analysisStatus" IN ('PENDING', 'PROCESSING');

CREATE INDEX "notification_deliveries_pending_createdAt_idx"
  ON "notification_deliveries" ("createdAt")
  WHERE "status" IN ('PENDING', 'SENDING');
