-- Phase 13: product-wide events, alert projection, and push delivery outbox.
CREATE TABLE "product_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "storeId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_events"
  ADD CONSTRAINT "product_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "product_events_organizationId_dedupeKey_key"
  ON "product_events"("organizationId", "dedupeKey");
CREATE INDEX "product_events_organizationId_kind_occurredAt_idx"
  ON "product_events"("organizationId", "kind", "occurredAt");

ALTER TABLE "alerts"
  ADD COLUMN "eventId" TEXT;

CREATE UNIQUE INDEX "alerts_eventId_key" ON "alerts"("eventId");

ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "product_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT,
  "alertId" TEXT,
  "deviceId" TEXT NOT NULL,
  "pushToken" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "product_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "notification_deliveries_deviceId_eventId_key"
  ON "notification_deliveries"("deviceId", "eventId");
CREATE INDEX "notification_deliveries_organizationId_status_createdAt_idx"
  ON "notification_deliveries"("organizationId", "status", "createdAt");
