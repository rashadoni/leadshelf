-- Guided Capture slice 1 (docs/24, Phase 10.6): capture templates,
-- step exceptions, capture flags/telemetry on proof media. Additive only.

CREATE TABLE "capture_templates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "equipmentTypeId" TEXT,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "steps" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "capture_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capture_templates_organizationId_equipmentTypeId_key"
  ON "capture_templates" ("organizationId", "equipmentTypeId");

CREATE INDEX "capture_templates_organizationId_isActive_idx"
  ON "capture_templates" ("organizationId", "isActive");

ALTER TABLE "capture_templates"
  ADD CONSTRAINT "capture_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_templates"
  ADD CONSTRAINT "capture_templates_equipmentTypeId_fkey"
  FOREIGN KEY ("equipmentTypeId") REFERENCES "equipment_types" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "capture_step_exceptions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "stepKind" TEXT,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "capture_step_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capture_step_exceptions_organizationId_taskId_idx"
  ON "capture_step_exceptions" ("organizationId", "taskId");

ALTER TABLE "capture_step_exceptions"
  ADD CONSTRAINT "capture_step_exceptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_step_exceptions"
  ADD CONSTRAINT "capture_step_exceptions_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "capture_step_exceptions"
  ADD CONSTRAINT "capture_step_exceptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "photo_submissions"
  ADD COLUMN "captureFlags" JSONB,
  ADD COLUMN "captureTelemetry" JSONB;
