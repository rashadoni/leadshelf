-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "prevRefreshHash" TEXT,
ADD COLUMN     "prevRefreshJti" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbox_operations" ADD COLUMN     "result" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employeeCode" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_employeeCode_key" ON "users"("organizationId", "employeeCode");

