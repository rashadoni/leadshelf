CREATE TABLE "rate_limit_buckets" (
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("scope", "keyHash")
);

CREATE INDEX "rate_limit_buckets_expiresAt_idx"
  ON "rate_limit_buckets"("expiresAt");
