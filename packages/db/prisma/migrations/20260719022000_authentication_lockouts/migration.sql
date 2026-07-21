CREATE TABLE "authentication_lockouts" (
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "failureCount" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowExpiresAt" TIMESTAMP(3) NOT NULL,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "authentication_lockouts_pkey" PRIMARY KEY ("scope", "keyHash")
);

CREATE INDEX "authentication_lockouts_lockedUntil_idx"
  ON "authentication_lockouts"("lockedUntil");

CREATE INDEX "authentication_lockouts_windowExpiresAt_idx"
  ON "authentication_lockouts"("windowExpiresAt");
