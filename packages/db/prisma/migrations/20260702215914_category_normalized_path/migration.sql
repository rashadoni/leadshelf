-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "normalizedPath" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "categories_organizationId_normalizedPath_key" ON "categories"("organizationId", "normalizedPath");

