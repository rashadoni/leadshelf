-- DropIndex
DROP INDEX "price_snapshots_natural_key";

-- DropIndex
DROP INDEX "sales_snapshots_natural_key";

-- DropIndex
DROP INDEX "stock_snapshots_natural_key";

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshFamilyId" TEXT NOT NULL,
    "refreshJti" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshJti_key" ON "auth_sessions"("refreshJti");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_organizationId_userId_idx" ON "auth_sessions"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "auth_sessions_refreshFamilyId_idx" ON "auth_sessions"("refreshFamilyId");
