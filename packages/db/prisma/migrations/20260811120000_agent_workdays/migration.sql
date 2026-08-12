CREATE TYPE "AgentWorkdayStatus" AS ENUM ('STARTED', 'PAUSED', 'COMPLETED');
CREATE TYPE "AgentWorkdayAction" AS ENUM ('START', 'PAUSE', 'RESUME', 'FINISH');

ALTER TABLE "agent_locations" ADD COLUMN "clientLocationId" TEXT;
CREATE UNIQUE INDEX "agent_locations_agentId_clientLocationId_key"
  ON "agent_locations"("agentId", "clientLocationId");

CREATE TABLE "agent_workdays" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "status" "AgentWorkdayStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "pausedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "totalPausedSeconds" INTEGER NOT NULL DEFAULT 0,
  "startLatitude" DOUBLE PRECISION,
  "startLongitude" DOUBLE PRECISION,
  "endLatitude" DOUBLE PRECISION,
  "endLongitude" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_workdays_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_workday_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workdayId" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "type" "AgentWorkdayAction" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_workday_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_workdays_organizationId_agentId_workDate_key"
  ON "agent_workdays"("organizationId", "agentId", "workDate");
CREATE INDEX "agent_workdays_organizationId_agentId_status_idx"
  ON "agent_workdays"("organizationId", "agentId", "status");
CREATE UNIQUE INDEX "agent_workday_events_organizationId_clientEventId_key"
  ON "agent_workday_events"("organizationId", "clientEventId");
CREATE INDEX "agent_workday_events_workdayId_occurredAt_idx"
  ON "agent_workday_events"("workdayId", "occurredAt");

ALTER TABLE "agent_workdays"
  ADD CONSTRAINT "agent_workdays_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_workdays"
  ADD CONSTRAINT "agent_workdays_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_workday_events"
  ADD CONSTRAINT "agent_workday_events_workdayId_fkey"
  FOREIGN KEY ("workdayId") REFERENCES "agent_workdays"("id") ON DELETE CASCADE ON UPDATE CASCADE;
