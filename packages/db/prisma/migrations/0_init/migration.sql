-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'CATEGORY_MANAGER', 'MERCHANDISER', 'SUPERVISOR', 'ANALYST', 'FIELD_AGENT', 'STORE_STAFF');

-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('PCS', 'BOX', 'KG', 'L', 'PACK');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'IN_REPAIR', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlanogramVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StackMode" AS ENUM ('NONE', 'ON_TOP', 'LYING');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'PHOTO_SUBMITTED', 'COMPLETED', 'EXPIRED', 'EMPTY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STORE_STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_formats" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "store_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "regionId" TEXT,
    "formatId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "store_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT,
    "formatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plan_versions" (
    "id" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "depthMm" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plan_equipment" (
    "id" TEXT NOT NULL,
    "floorPlanVersionId" TEXT NOT NULL,
    "equipmentVersionId" TEXT NOT NULL,
    "planogramId" TEXT,
    "label" TEXT,
    "xMm" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "rotationDeg" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "floor_plan_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalCode" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "brandId" TEXT,
    "supplierId" TEXT,
    "manufacturerId" TEXT,
    "unit" "ProductUnit" NOT NULL DEFAULT 'PCS',
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "depthMm" INTEGER,
    "weightG" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'front',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'string',
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assortment_matrix" (
    "id" TEXT NOT NULL,
    "formatId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),

    CONSTRAINT "assortment_matrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_assortment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),

    CONSTRAINT "store_assortment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalCode" TEXT,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT,
    "date" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'AZN',

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT,
    "warehouseId" TEXT,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "profit" DECIMAL(14,2),

    CONSTRAINT "sales_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "sourceRow" JSONB,
    "field" TEXT,
    "reason" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "suggestedFix" TEXT,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_id_map" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,

    CONSTRAINT "external_id_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "equipment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "depthMm" INTEGER NOT NULL,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_shelves" (
    "id" TEXT NOT NULL,
    "equipmentVersionId" TEXT NOT NULL,
    "shelfIndex" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "thicknessMm" INTEGER NOT NULL DEFAULT 20,
    "depthMm" INTEGER NOT NULL,
    "maxLoadKg" INTEGER,

    CONSTRAINT "equipment_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_cells" (
    "id" TEXT NOT NULL,
    "equipmentVersionId" TEXT NOT NULL,
    "xMm" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "depthMm" INTEGER NOT NULL,

    CONSTRAINT "equipment_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_hooks" (
    "id" TEXT NOT NULL,
    "equipmentVersionId" TEXT NOT NULL,
    "xMm" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "lengthMm" INTEGER NOT NULL,

    CONSTRAINT "equipment_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "templateId" TEXT,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_asset_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus" NOT NULL,
    "note" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_inspections" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "visitId" TEXT,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT[],
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_requests" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" "RepairStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "description" TEXT NOT NULL,
    "photoUrls" TEXT[],
    "reportedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planograms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planograms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planogram_versions" (
    "id" TEXT NOT NULL,
    "planogramId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "state" "PlanogramVersionState" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planogram_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planogram_equipment" (
    "id" TEXT NOT NULL,
    "planogramVersionId" TEXT NOT NULL,
    "equipmentVersionId" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planogram_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planogram_zones" (
    "id" TEXT NOT NULL,
    "planogramVersionId" TEXT NOT NULL,
    "planogramEquipmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "xMm" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,

    CONSTRAINT "planogram_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planogram_placements" (
    "id" TEXT NOT NULL,
    "planogramVersionId" TEXT NOT NULL,
    "planogramEquipmentId" TEXT NOT NULL,
    "shelfId" TEXT,
    "zoneId" TEXT,
    "productId" TEXT NOT NULL,
    "xMm" INTEGER NOT NULL,
    "yMm" INTEGER NOT NULL,
    "zMm" INTEGER NOT NULL DEFAULT 0,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "depthMm" INTEGER NOT NULL,
    "facingsX" INTEGER NOT NULL DEFAULT 1,
    "facingsY" INTEGER NOT NULL DEFAULT 1,
    "facingsZ" INTEGER NOT NULL DEFAULT 1,
    "rotationX" INTEGER NOT NULL DEFAULT 0,
    "rotationY" INTEGER NOT NULL DEFAULT 0,
    "rotationZ" INTEGER NOT NULL DEFAULT 0,
    "compressionX" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "compressionY" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "compressionZ" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "stackMode" "StackMode" NOT NULL DEFAULT 'NONE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "planogram_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planogram_assignments" (
    "id" TEXT NOT NULL,
    "planogramVersionId" TEXT NOT NULL,
    "storeId" TEXT,
    "formatId" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planogram_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planogramVersionId" TEXT,
    "assignmentId" TEXT,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus" NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_submissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "taskId" TEXT,
    "visitId" TEXT,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "clientPhotoId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "exif" JSONB,
    "qualityScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceName" TEXT,
    "pushToken" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientOpId" TEXT,
    "collection" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "serverData" JSONB NOT NULL,
    "clientData" JSONB NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_operations" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientOpId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leadUserId" TEXT,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_agents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "phone" TEXT,
    "employeeCode" TEXT,

    CONSTRAINT "field_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT,
    "weekdays" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "plannedAt" TIMESTAMP(3),

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "routeStopId" TEXT,
    "status" "VisitStatus" NOT NULL DEFAULT 'PLANNED',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "anomalyFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_locations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "agentId" TEXT,
    "visitId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "promotionId" TEXT,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_products" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_limits" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "limitAmount" DECIMAL(14,2) NOT NULL,
    "usedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "storeId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_StoreGroupMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_StoreGroupMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_organizationId_idx" ON "api_tokens"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "regions_organizationId_idx" ON "regions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "store_formats_organizationId_name_key" ON "store_formats"("organizationId", "name");

-- CreateIndex
CREATE INDEX "stores_organizationId_formatId_idx" ON "stores"("organizationId", "formatId");

-- CreateIndex
CREATE INDEX "stores_organizationId_regionId_idx" ON "stores"("organizationId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_organizationId_code_key" ON "stores"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "store_groups_organizationId_name_key" ON "store_groups"("organizationId", "name");

-- CreateIndex
CREATE INDEX "floor_plans_organizationId_idx" ON "floor_plans"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "floor_plan_versions_floorPlanId_versionNumber_key" ON "floor_plan_versions"("floorPlanId", "versionNumber");

-- CreateIndex
CREATE INDEX "floor_plan_equipment_floorPlanVersionId_idx" ON "floor_plan_equipment"("floorPlanVersionId");

-- CreateIndex
CREATE INDEX "floor_plan_equipment_planogramId_idx" ON "floor_plan_equipment"("planogramId");

-- CreateIndex
CREATE INDEX "categories_organizationId_parentId_idx" ON "categories"("organizationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_organizationId_name_key" ON "brands"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_name_key" ON "suppliers"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_organizationId_name_key" ON "manufacturers"("organizationId", "name");

-- CreateIndex
CREATE INDEX "products_organizationId_categoryId_idx" ON "products"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "products_organizationId_brandId_idx" ON "products"("organizationId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_sku_key" ON "products"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "product_barcodes_productId_idx" ON "product_barcodes"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_organizationId_barcode_key" ON "product_barcodes"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_definitions_organizationId_name_key" ON "product_attribute_definitions"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_values_productId_definitionId_key" ON "product_attribute_values"("productId", "definitionId");

-- CreateIndex
CREATE INDEX "assortment_matrix_productId_idx" ON "assortment_matrix"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "assortment_matrix_formatId_productId_key" ON "assortment_matrix"("formatId", "productId");

-- CreateIndex
CREATE INDEX "store_assortment_productId_idx" ON "store_assortment"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "store_assortment_storeId_productId_key" ON "store_assortment"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organizationId_name_key" ON "warehouses"("organizationId", "name");

-- CreateIndex
CREATE INDEX "price_snapshots_productId_storeId_date_idx" ON "price_snapshots"("productId", "storeId", "date");

-- CreateIndex
CREATE INDEX "price_snapshots_storeId_date_idx" ON "price_snapshots"("storeId", "date");

-- CreateIndex
CREATE INDEX "price_snapshots_organizationId_date_idx" ON "price_snapshots"("organizationId", "date");

-- CreateIndex
CREATE INDEX "stock_snapshots_productId_storeId_warehouseId_date_idx" ON "stock_snapshots"("productId", "storeId", "warehouseId", "date");

-- CreateIndex
CREATE INDEX "stock_snapshots_storeId_date_idx" ON "stock_snapshots"("storeId", "date");

-- CreateIndex
CREATE INDEX "stock_snapshots_organizationId_date_idx" ON "stock_snapshots"("organizationId", "date");

-- CreateIndex
CREATE INDEX "sales_snapshots_productId_storeId_date_idx" ON "sales_snapshots"("productId", "storeId", "date");

-- CreateIndex
CREATE INDEX "sales_snapshots_storeId_date_idx" ON "sales_snapshots"("storeId", "date");

-- CreateIndex
CREATE INDEX "sales_snapshots_organizationId_date_idx" ON "sales_snapshots"("organizationId", "date");

-- CreateIndex
CREATE INDEX "import_batches_organizationId_entityType_createdAt_idx" ON "import_batches"("organizationId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "import_errors_batchId_idx" ON "import_errors"("batchId");

-- CreateIndex
CREATE INDEX "external_id_map_organizationId_entityType_internalId_idx" ON "external_id_map"("organizationId", "entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "external_id_map_organizationId_system_entityType_externalId_key" ON "external_id_map"("organizationId", "system", "entityType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_types_organizationId_name_key" ON "equipment_types"("organizationId", "name");

-- CreateIndex
CREATE INDEX "equipment_templates_organizationId_idx" ON "equipment_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_versions_templateId_versionNumber_key" ON "equipment_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_shelves_equipmentVersionId_shelfIndex_key" ON "equipment_shelves"("equipmentVersionId", "shelfIndex");

-- CreateIndex
CREATE INDEX "equipment_cells_equipmentVersionId_idx" ON "equipment_cells"("equipmentVersionId");

-- CreateIndex
CREATE INDEX "equipment_hooks_equipmentVersionId_idx" ON "equipment_hooks"("equipmentVersionId");

-- CreateIndex
CREATE INDEX "equipment_assets_organizationId_storeId_idx" ON "equipment_assets"("organizationId", "storeId");

-- CreateIndex
CREATE INDEX "equipment_asset_history_assetId_createdAt_idx" ON "equipment_asset_history"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "equipment_inspections_assetId_createdAt_idx" ON "equipment_inspections"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "repair_requests_status_idx" ON "repair_requests"("status");

-- CreateIndex
CREATE INDEX "planograms_organizationId_categoryId_idx" ON "planograms"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "planogram_versions_planogramId_state_idx" ON "planogram_versions"("planogramId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "planogram_versions_planogramId_versionNumber_key" ON "planogram_versions"("planogramId", "versionNumber");

-- CreateIndex
CREATE INDEX "planogram_equipment_planogramVersionId_idx" ON "planogram_equipment"("planogramVersionId");

-- CreateIndex
CREATE INDEX "planogram_zones_planogramVersionId_idx" ON "planogram_zones"("planogramVersionId");

-- CreateIndex
CREATE INDEX "planogram_placements_planogramVersionId_idx" ON "planogram_placements"("planogramVersionId");

-- CreateIndex
CREATE INDEX "planogram_placements_productId_idx" ON "planogram_placements"("productId");

-- CreateIndex
CREATE INDEX "planogram_assignments_storeId_idx" ON "planogram_assignments"("storeId");

-- CreateIndex
CREATE INDEX "planogram_assignments_formatId_idx" ON "planogram_assignments"("formatId");

-- CreateIndex
CREATE INDEX "planogram_assignments_planogramVersionId_idx" ON "planogram_assignments"("planogramVersionId");

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_dueAt_idx" ON "tasks"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_storeId_status_idx" ON "tasks"("storeId", "status");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_status_idx" ON "tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "task_status_history_taskId_createdAt_idx" ON "task_status_history"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "photo_submissions_organizationId_storeId_takenAt_idx" ON "photo_submissions"("organizationId", "storeId", "takenAt");

-- CreateIndex
CREATE INDEX "photo_submissions_taskId_idx" ON "photo_submissions"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "photo_submissions_organizationId_clientPhotoId_key" ON "photo_submissions"("organizationId", "clientPhotoId");

-- CreateIndex
CREATE INDEX "mobile_devices_userId_idx" ON "mobile_devices"("userId");

-- CreateIndex
CREATE INDEX "sync_conflicts_deviceId_resolvedAt_idx" ON "sync_conflicts"("deviceId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_deviceId_collection_key" ON "sync_cursors"("deviceId", "collection");

-- CreateIndex
CREATE INDEX "outbox_operations_deviceId_status_idx" ON "outbox_operations"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_operations_deviceId_clientOpId_key" ON "outbox_operations"("deviceId", "clientOpId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_name_key" ON "teams"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "field_agents_userId_key" ON "field_agents"("userId");

-- CreateIndex
CREATE INDEX "routes_organizationId_agentId_idx" ON "routes"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "route_stops_storeId_idx" ON "route_stops"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_sortOrder_key" ON "route_stops"("routeId", "sortOrder");

-- CreateIndex
CREATE INDEX "visits_organizationId_agentId_checkInAt_idx" ON "visits"("organizationId", "agentId", "checkInAt");

-- CreateIndex
CREATE INDEX "visits_storeId_checkInAt_idx" ON "visits"("storeId", "checkInAt");

-- CreateIndex
CREATE INDEX "agent_locations_agentId_recordedAt_idx" ON "agent_locations"("agentId", "recordedAt");

-- CreateIndex
CREATE INDEX "orders_organizationId_status_createdAt_idx" ON "orders"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_storeId_idx" ON "orders"("storeId");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "promotions_organizationId_isActive_idx" ON "promotions"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_products_promotionId_productId_key" ON "promotion_products"("promotionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_limits_storeId_key" ON "credit_limits"("storeId");

-- CreateIndex
CREATE INDEX "alerts_organizationId_isResolved_createdAt_idx" ON "alerts"("organizationId", "isResolved", "createdAt");

-- CreateIndex
CREATE INDEX "_StoreGroupMembers_B_index" ON "_StoreGroupMembers"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_formats" ADD CONSTRAINT "store_formats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "store_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_groups" ADD CONSTRAINT "store_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "store_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_versions" ADD CONSTRAINT "floor_plan_versions_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_equipment" ADD CONSTRAINT "floor_plan_equipment_floorPlanVersionId_fkey" FOREIGN KEY ("floorPlanVersionId") REFERENCES "floor_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_equipment" ADD CONSTRAINT "floor_plan_equipment_equipmentVersionId_fkey" FOREIGN KEY ("equipmentVersionId") REFERENCES "equipment_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_equipment" ADD CONSTRAINT "floor_plan_equipment_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "planograms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "product_attribute_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assortment_matrix" ADD CONSTRAINT "assortment_matrix_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "store_formats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assortment_matrix" ADD CONSTRAINT "assortment_matrix_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_assortment" ADD CONSTRAINT "store_assortment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_assortment" ADD CONSTRAINT "store_assortment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_snapshots" ADD CONSTRAINT "sales_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_snapshots" ADD CONSTRAINT "sales_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_types" ADD CONSTRAINT "equipment_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_templates" ADD CONSTRAINT "equipment_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_templates" ADD CONSTRAINT "equipment_templates_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "equipment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_versions" ADD CONSTRAINT "equipment_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "equipment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_shelves" ADD CONSTRAINT "equipment_shelves_equipmentVersionId_fkey" FOREIGN KEY ("equipmentVersionId") REFERENCES "equipment_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_cells" ADD CONSTRAINT "equipment_cells_equipmentVersionId_fkey" FOREIGN KEY ("equipmentVersionId") REFERENCES "equipment_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_hooks" ADD CONSTRAINT "equipment_hooks_equipmentVersionId_fkey" FOREIGN KEY ("equipmentVersionId") REFERENCES "equipment_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "equipment_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_asset_history" ADD CONSTRAINT "equipment_asset_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "equipment_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_inspections" ADD CONSTRAINT "equipment_inspections_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "equipment_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "equipment_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planograms" ADD CONSTRAINT "planograms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planograms" ADD CONSTRAINT "planograms_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_versions" ADD CONSTRAINT "planogram_versions_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "planograms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_equipment" ADD CONSTRAINT "planogram_equipment_planogramVersionId_fkey" FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_equipment" ADD CONSTRAINT "planogram_equipment_equipmentVersionId_fkey" FOREIGN KEY ("equipmentVersionId") REFERENCES "equipment_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_zones" ADD CONSTRAINT "planogram_zones_planogramVersionId_fkey" FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_zones" ADD CONSTRAINT "planogram_zones_planogramEquipmentId_fkey" FOREIGN KEY ("planogramEquipmentId") REFERENCES "planogram_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_placements" ADD CONSTRAINT "planogram_placements_planogramVersionId_fkey" FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_placements" ADD CONSTRAINT "planogram_placements_planogramEquipmentId_fkey" FOREIGN KEY ("planogramEquipmentId") REFERENCES "planogram_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_placements" ADD CONSTRAINT "planogram_placements_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "equipment_shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_placements" ADD CONSTRAINT "planogram_placements_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "planogram_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_placements" ADD CONSTRAINT "planogram_placements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_assignments" ADD CONSTRAINT "planogram_assignments_planogramVersionId_fkey" FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_assignments" ADD CONSTRAINT "planogram_assignments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planogram_assignments" ADD CONSTRAINT "planogram_assignments_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "store_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_planogramVersionId_fkey" FOREIGN KEY ("planogramVersionId") REFERENCES "planogram_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "planogram_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_operations" ADD CONSTRAINT "outbox_operations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_agents" ADD CONSTRAINT "field_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_agents" ADD CONSTRAINT "field_agents_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_routeStopId_fkey" FOREIGN KEY ("routeStopId") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_locations" ADD CONSTRAINT "agent_locations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "field_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limits" ADD CONSTRAINT "credit_limits_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoreGroupMembers" ADD CONSTRAINT "_StoreGroupMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StoreGroupMembers" ADD CONSTRAINT "_StoreGroupMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "store_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Raw SQL constraints (MIGRATION_NOTES.md). Prisma не выражает их сам.
-- ============================================================================

-- [MN #2] PlanogramAssignment: ровно одна цель (store XOR format).
ALTER TABLE "planogram_assignments"
  ADD CONSTRAINT "planogram_assignment_exactly_one_target"
  CHECK (num_nonnulls("storeId", "formatId") = 1);

-- [MN #1] Уникальность снапшотов с nullable-колонками (Postgres 15+):
-- NULL трактуется как значение, иначе org-wide строки (storeId IS NULL)
-- дублировались бы.
CREATE UNIQUE INDEX "price_snapshots_natural_key"
  ON "price_snapshots" ("productId", "storeId", "date") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "stock_snapshots_natural_key"
  ON "stock_snapshots" ("productId", "storeId", "warehouseId", "date") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "sales_snapshots_natural_key"
  ON "sales_snapshots" ("productId", "storeId", "date") NULLS NOT DISTINCT;

-- ОТЛОЖЕНО (MN #3 publish-инварианты, #4 graph-целостность): PL/pgSQL
-- триггеры добавятся отдельной миграцией в Phase 4-6, когда появится
-- код, пишущий в planogram_*/tasks. Сейчас таблицы пусты, писателей нет;
-- инварианты дублируются проверкой в app-слое (packages/core).
