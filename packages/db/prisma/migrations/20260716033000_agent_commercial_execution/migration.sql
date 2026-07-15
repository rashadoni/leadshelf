-- Agent commercial execution: promotion proof, append-only promo inventory,
-- order returns, and reward claims. LeadShelf remains the source of truth;
-- mobile writes are idempotent through clientDeviceId + clientOpId.

CREATE TYPE "PromotionExecutionStatus" AS ENUM ('ENROLLED', 'SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "PromoInventoryItemKind" AS ENUM ('SAMPLE', 'MATERIAL');
CREATE TYPE "PromoInventoryEventType" AS ENUM ('RECEIVE', 'ISSUE', 'RETURN', 'COUNT_ADJUSTMENT');
CREATE TYPE "SalesReturnStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RECEIVED');
CREATE TYPE "RewardClaimStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');

CREATE TABLE "promotion_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visitId" TEXT,
    "clientExecutionId" TEXT NOT NULL,
    "status" "PromotionExecutionStatus" NOT NULL DEFAULT 'ENROLLED',
    "note" TEXT,
    "proofPhotoUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_inventory_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromoInventoryItemKind" NOT NULL,
    "productId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "promo_inventory_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "storeId" TEXT,
    "visitId" TEXT,
    "eventType" "PromoInventoryEventType" NOT NULL,
    "quantityDelta" DECIMAL(14,3) NOT NULL,
    "countedBalance" DECIMAL(14,3),
    "reason" TEXT,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "clientDeviceId" TEXT NOT NULL,
    "clientOpId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_inventory_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visitId" TEXT,
    "status" "SalesReturnStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "evidencePhotoUrl" TEXT,
    "clientDeviceId" TEXT NOT NULL,
    "clientOpId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_return_lines" (
    "id" TEXT NOT NULL,
    "salesReturnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_catalog_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "stockQuantity" INTEGER,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reward_claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rewardItemId" TEXT NOT NULL,
    "status" "RewardClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pointsCost" INTEGER NOT NULL,
    "note" TEXT,
    "clientDeviceId" TEXT NOT NULL,
    "clientOpId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_executions_organizationId_clientExecutionId_key"
ON "promotion_executions"("organizationId", "clientExecutionId");
CREATE INDEX "promotion_executions_organizationId_agentId_updatedAt_idx"
ON "promotion_executions"("organizationId", "agentId", "updatedAt");
CREATE INDEX "promotion_executions_organizationId_promotionId_storeId_idx"
ON "promotion_executions"("organizationId", "promotionId", "storeId");

CREATE UNIQUE INDEX "promo_inventory_items_organizationId_code_key"
ON "promo_inventory_items"("organizationId", "code");
CREATE INDEX "promo_inventory_items_organizationId_kind_isActive_idx"
ON "promo_inventory_items"("organizationId", "kind", "isActive");

CREATE UNIQUE INDEX "promo_inventory_events_clientDeviceId_clientOpId_key"
ON "promo_inventory_events"("clientDeviceId", "clientOpId");
CREATE INDEX "promo_inventory_events_organizationId_agentId_itemId_recordedAt_idx"
ON "promo_inventory_events"("organizationId", "agentId", "itemId", "recordedAt");
CREATE INDEX "promo_inventory_events_organizationId_storeId_recordedAt_idx"
ON "promo_inventory_events"("organizationId", "storeId", "recordedAt");

CREATE UNIQUE INDEX "sales_returns_clientDeviceId_clientOpId_key"
ON "sales_returns"("clientDeviceId", "clientOpId");
CREATE INDEX "sales_returns_organizationId_agentId_updatedAt_idx"
ON "sales_returns"("organizationId", "agentId", "updatedAt");
CREATE INDEX "sales_returns_organizationId_orderId_idx"
ON "sales_returns"("organizationId", "orderId");

CREATE UNIQUE INDEX "sales_return_lines_salesReturnId_orderLineId_key"
ON "sales_return_lines"("salesReturnId", "orderLineId");
CREATE INDEX "sales_return_lines_productId_idx" ON "sales_return_lines"("productId");

CREATE UNIQUE INDEX "reward_catalog_items_organizationId_code_key"
ON "reward_catalog_items"("organizationId", "code");
CREATE INDEX "reward_catalog_items_organizationId_isActive_idx"
ON "reward_catalog_items"("organizationId", "isActive");

CREATE UNIQUE INDEX "reward_accounts_agentId_key" ON "reward_accounts"("agentId");
CREATE INDEX "reward_accounts_organizationId_updatedAt_idx"
ON "reward_accounts"("organizationId", "updatedAt");

CREATE INDEX "reward_ledger_entries_organizationId_accountId_createdAt_idx"
ON "reward_ledger_entries"("organizationId", "accountId", "createdAt");
CREATE INDEX "reward_ledger_entries_organizationId_sourceType_sourceId_idx"
ON "reward_ledger_entries"("organizationId", "sourceType", "sourceId");

CREATE UNIQUE INDEX "reward_claims_clientDeviceId_clientOpId_key"
ON "reward_claims"("clientDeviceId", "clientOpId");
CREATE INDEX "reward_claims_organizationId_accountId_updatedAt_idx"
ON "reward_claims"("organizationId", "accountId", "updatedAt");
CREATE INDEX "reward_claims_organizationId_status_submittedAt_idx"
ON "reward_claims"("organizationId", "status", "submittedAt");

ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_promotionId_fkey"
FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_visitId_fkey"
FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotion_executions" ADD CONSTRAINT "promotion_executions_decidedById_fkey"
FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "promo_inventory_items" ADD CONSTRAINT "promo_inventory_items_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_inventory_items" ADD CONSTRAINT "promo_inventory_items_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "promo_inventory_events" ADD CONSTRAINT "promo_inventory_events_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_inventory_events" ADD CONSTRAINT "promo_inventory_events_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "promo_inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_inventory_events" ADD CONSTRAINT "promo_inventory_events_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_inventory_events" ADD CONSTRAINT "promo_inventory_events_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_inventory_events" ADD CONSTRAINT "promo_inventory_events_visitId_fkey"
FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_visitId_fkey"
FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_decidedById_fkey"
FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_salesReturnId_fkey"
FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_orderLineId_fkey"
FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reward_catalog_items" ADD CONSTRAINT "reward_catalog_items_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "reward_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "reward_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_rewardItemId_fkey"
FOREIGN KEY ("rewardItemId") REFERENCES "reward_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_decidedById_fkey"
FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
