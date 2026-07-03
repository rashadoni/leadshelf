-- AI / Vision optional layer: golden references are photo-based check targets,
-- not the source of truth for planogram placement.

CREATE TYPE "GoldenReferenceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "golden_references" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planogramVersionId" TEXT NOT NULL,
  "photoSubmissionId" TEXT,
  "imageUrl" TEXT NOT NULL,
  "status" "GoldenReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "golden_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "golden_reference_slots" (
  "id" TEXT NOT NULL,
  "goldenReferenceId" TEXT NOT NULL,
  "placementId" TEXT,
  "productId" TEXT,
  "xPct" DOUBLE PRECISION NOT NULL,
  "yPct" DOUBLE PRECISION NOT NULL,
  "widthPct" DOUBLE PRECISION NOT NULL,
  "heightPct" DOUBLE PRECISION NOT NULL,
  "label" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "golden_reference_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "golden_references_organizationId_planogramVersionId_status_idx"
  ON "golden_references"("organizationId", "planogramVersionId", "status");
CREATE INDEX "golden_references_photoSubmissionId_idx"
  ON "golden_references"("photoSubmissionId");
CREATE INDEX "golden_reference_slots_goldenReferenceId_idx"
  ON "golden_reference_slots"("goldenReferenceId");
CREATE INDEX "golden_reference_slots_productId_idx"
  ON "golden_reference_slots"("productId");

ALTER TABLE "golden_references"
  ADD CONSTRAINT "golden_references_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "golden_references"
  ADD CONSTRAINT "golden_references_planogramVersionId_fkey"
  FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "golden_references"
  ADD CONSTRAINT "golden_references_photoSubmissionId_fkey"
  FOREIGN KEY ("photoSubmissionId") REFERENCES "photo_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "golden_reference_slots"
  ADD CONSTRAINT "golden_reference_slots_goldenReferenceId_fkey"
  FOREIGN KEY ("goldenReferenceId") REFERENCES "golden_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "golden_reference_slots"
  ADD CONSTRAINT "golden_reference_slots_placementId_fkey"
  FOREIGN KEY ("placementId") REFERENCES "planogram_placements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "golden_reference_slots"
  ADD CONSTRAINT "golden_reference_slots_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
