CREATE TABLE "field_force_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gpsRefreshSeconds" INTEGER NOT NULL DEFAULT 15,
    "geofenceRadiusM" INTEGER NOT NULL DEFAULT 120,
    "offlineAfterMinutes" INTEGER NOT NULL DEFAULT 45,
    "requirePhotoProof" BOOLEAN NOT NULL DEFAULT true,
    "requireShelfScan" BOOLEAN NOT NULL DEFAULT true,
    "alertLateVisits" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_force_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_force_settings_gpsRefreshSeconds_check" CHECK ("gpsRefreshSeconds" BETWEEN 5 AND 120),
    CONSTRAINT "field_force_settings_geofenceRadiusM_check" CHECK ("geofenceRadiusM" BETWEEN 30 AND 1000),
    CONSTRAINT "field_force_settings_offlineAfterMinutes_check" CHECK ("offlineAfterMinutes" BETWEEN 5 AND 240)
);

CREATE UNIQUE INDEX "field_force_settings_organizationId_key"
  ON "field_force_settings"("organizationId");

ALTER TABLE "field_force_settings"
  ADD CONSTRAINT "field_force_settings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
