-- Durable import queue for large catalog files.
CREATE TABLE "import_queue_jobs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "encoding" TEXT,
  "delimiter" TEXT,
  "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "import_queue_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "import_queue_jobs"
  ADD CONSTRAINT "import_queue_jobs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_queue_jobs"
  ADD CONSTRAINT "import_queue_jobs_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "import_queue_jobs_batchId_key" ON "import_queue_jobs"("batchId");
CREATE INDEX "import_queue_jobs_organizationId_status_createdAt_idx"
  ON "import_queue_jobs"("organizationId", "status", "createdAt");
