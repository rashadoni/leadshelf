-- Retry scheduling and lease recovery for push delivery workers.
ALTER TABLE "notification_deliveries"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3);

CREATE INDEX "notification_deliveries_status_availableAt_createdAt_idx"
  ON "notification_deliveries"("status", "availableAt", "createdAt");
