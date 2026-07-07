-- Per-step retake loop (docs/23 web review backlog): office requests a
-- retake of a specific capture step; mobile reopens it. Additive only.

CREATE TABLE "capture_retake_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "stepKind" TEXT,
  "note" TEXT,
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "capture_retake_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capture_retake_requests_organizationId_taskId_stepId_key"
  ON "capture_retake_requests" ("organizationId", "taskId", "stepId");

CREATE INDEX "capture_retake_requests_organizationId_taskId_resolvedAt_idx"
  ON "capture_retake_requests" ("organizationId", "taskId", "resolvedAt");

ALTER TABLE "capture_retake_requests"
  ADD CONSTRAINT "capture_retake_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_retake_requests"
  ADD CONSTRAINT "capture_retake_requests_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_retake_requests"
  ADD CONSTRAINT "capture_retake_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
