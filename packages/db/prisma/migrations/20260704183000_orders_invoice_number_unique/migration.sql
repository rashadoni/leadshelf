-- Orders Phase 12: invoice numbers must be unique within an organization.
-- Postgres unique indexes allow multiple NULL invoice numbers for drafts.
CREATE UNIQUE INDEX "orders_organizationId_invoiceNumber_key"
  ON "orders"("organizationId", "invoiceNumber");
