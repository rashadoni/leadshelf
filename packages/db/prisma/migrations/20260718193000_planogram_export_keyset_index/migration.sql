-- Supports bounded full analytics exports ordered by version/product/placement.
CREATE INDEX "planogram_placements_planogramVersionId_productId_sortOrder_id_idx"
  ON "planogram_placements"("planogramVersionId", "productId", "sortOrder", "id");
