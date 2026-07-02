-- Natural keys снапшотов (MIGRATION_NOTES п.1): UNIQUE NULLS NOT DISTINCT,
-- иначе org-wide строки (storeId IS NULL) дублируются при каждом импорте.
ALTER TABLE "price_snapshots"
  ADD CONSTRAINT "price_snapshots_natural_key"
  UNIQUE NULLS NOT DISTINCT ("productId", "storeId", "date");

ALTER TABLE "stock_snapshots"
  ADD CONSTRAINT "stock_snapshots_natural_key"
  UNIQUE NULLS NOT DISTINCT ("productId", "storeId", "warehouseId", "date");

ALTER TABLE "sales_snapshots"
  ADD CONSTRAINT "sales_snapshots_natural_key"
  UNIQUE NULLS NOT DISTINCT ("productId", "storeId", "date");
