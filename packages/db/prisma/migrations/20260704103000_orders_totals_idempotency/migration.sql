-- Orders Phase 12: precise totals, invoice payload, and offline idempotency.
ALTER TABLE "orders"
  ADD COLUMN "subtotalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "appliedPromotions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "invoiceHtml" TEXT,
  ADD COLUMN "pdfUrl" TEXT,
  ADD COLUMN "clientDeviceId" TEXT,
  ADD COLUMN "clientOpId" TEXT;

ALTER TABLE "order_lines"
  ADD COLUMN "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "orders_clientDeviceId_clientOpId_key"
  ON "orders"("clientDeviceId", "clientOpId");
