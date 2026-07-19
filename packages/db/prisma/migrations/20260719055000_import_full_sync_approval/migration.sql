ALTER TABLE "import_queue_jobs"
  ADD COLUMN "syncMode" TEXT NOT NULL DEFAULT 'delta',
  ADD COLUMN "fullSyncApprovalPath" TEXT,
  ADD COLUMN "fullSyncApprovedAt" TIMESTAMP(3);

ALTER TABLE "import_queue_jobs"
  ADD CONSTRAINT "import_queue_jobs_sync_mode_check"
  CHECK ("syncMode" IN ('delta', 'full')),
  ADD CONSTRAINT "import_queue_jobs_full_sync_approval_pair_check"
  CHECK (("fullSyncApprovalPath" IS NULL) = ("fullSyncApprovedAt" IS NULL)),
  ADD CONSTRAINT "import_queue_jobs_delta_has_no_approval_check"
  CHECK ("syncMode" = 'full' OR ("fullSyncApprovalPath" IS NULL AND "fullSyncApprovedAt" IS NULL));

CREATE INDEX "import_queue_jobs_full_sync_waiting_idx"
  ON "import_queue_jobs" ("organizationId", "createdAt")
  WHERE "syncMode" = 'full' AND "fullSyncApprovalPath" IS NULL AND "status" = 'PENDING';
