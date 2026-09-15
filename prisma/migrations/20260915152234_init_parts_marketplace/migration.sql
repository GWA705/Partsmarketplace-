-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('DEALER', 'STAFF');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('VIEWER', 'ORDERER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CodeSegmentKind" AS ENUM ('DEPARTMENT', 'WAREHOUSE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PartSource" AS ENUM ('PRICE_LIST', 'PRICE_LIST_AND_CATALOGUE', 'CATALOGUE_ONLY');

-- CreateEnum
CREATE TYPE "FulfilledBy" AS ENUM ('HEAD_OFFICE', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "BuyerKind" AS ENUM ('DEALER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PriceRuleScope" AS ENUM ('CATEGORY', 'VENDOR', 'SEGMENT', 'TIER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "staffRole" "StaffRole" NOT NULL DEFAULT 'VIEWER',
    "dealerId" TEXT,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "shipAttn" TEXT,
    "shipLine1" TEXT,
    "shipLine2" TEXT,
    "shipCity" TEXT,
    "shipProvince" TEXT,
    "shipPostal" TEXT,
    "shipCountry" TEXT DEFAULT 'Canada',
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "fulfillmentNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeSegment" (
    "code" TEXT NOT NULL,
    "kind" "CodeSegmentKind" NOT NULL DEFAULT 'UNKNOWN',
    "label" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeSegment_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "catalogueCode" TEXT,
    "name" TEXT NOT NULL,
    "catalogueName" TEXT,
    "vendor" TEXT,
    "unit" TEXT,
    "costCents" INTEGER,
    "dealerCents" INTEGER,
    "priceOverridden" BOOLEAN NOT NULL DEFAULT false,
    "fulfilledBy" "FulfilledBy" NOT NULL DEFAULT 'HEAD_OFFICE',
    "categoryId" TEXT,
    "segmentCode" TEXT,
    "source" "PartSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "imageStorageKey" TEXT,
    "imageMime" TEXT,
    "imageSizeBytes" INTEGER,
    "note" TEXT,
    "fitsSkus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alsoUsedFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buyerKind" "BuyerKind" NOT NULL,
    "dealerId" TEXT,
    "placedById" TEXT NOT NULL,
    "placedByName" TEXT NOT NULL,
    "jobRef" TEXT,
    "note" TEXT,
    "shipName" TEXT,
    "shipLine1" TEXT,
    "shipLine2" TEXT,
    "shipCity" TEXT,
    "shipProvince" TEXT,
    "shipPostal" TEXT,
    "shipCountry" TEXT,
    "shipPhone" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fulfilledBy" "FulfilledBy" NOT NULL,
    "vendor" TEXT,
    "shippingMethod" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notifiedAt" TIMESTAMP(3),
    "notifiedTo" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "trackingRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "partId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "unit" TEXT,
    "unitCents" INTEGER,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultMarkupPct" INTEGER NOT NULL DEFAULT 35,
    "pricesVisibleToDealers" BOOLEAN NOT NULL DEFAULT false,
    "roundToCents" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "scope" "PriceRuleScope" NOT NULL,
    "target" TEXT NOT NULL,
    "markupPct" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentContact" (
    "id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ccEmail" TEXT,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "problems" TEXT,
    "actorName" TEXT,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_dealerId_idx" ON "User"("dealerId");

-- CreateIndex
CREATE INDEX "User_kind_active_idx" ON "User"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_name_key" ON "Dealer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_code_key" ON "Dealer"("code");

-- CreateIndex
CREATE INDEX "Dealer_active_idx" ON "Dealer"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PartCategory_name_key" ON "PartCategory"("name");

-- CreateIndex
CREATE INDEX "PartCategory_active_idx" ON "PartCategory"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Part_code_key" ON "Part"("code");

-- CreateIndex
CREATE INDEX "Part_active_sortOrder_idx" ON "Part"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Part_categoryId_idx" ON "Part"("categoryId");

-- CreateIndex
CREATE INDEX "Part_vendor_idx" ON "Part"("vendor");

-- CreateIndex
CREATE INDEX "Part_segmentCode_idx" ON "Part"("segmentCode");

-- CreateIndex
CREATE INDEX "Part_fulfilledBy_idx" ON "Part"("fulfilledBy");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_dealerId_submittedAt_idx" ON "Order"("dealerId", "submittedAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_submittedAt_idx" ON "Order"("submittedAt");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_vendor_idx" ON "Shipment"("vendor");

-- CreateIndex
CREATE INDEX "OrderLine_shipmentId_idx" ON "OrderLine"("shipmentId");

-- CreateIndex
CREATE INDEX "OrderLine_partId_idx" ON "OrderLine"("partId");

-- CreateIndex
CREATE INDEX "CartLine_userId_idx" ON "CartLine"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CartLine_userId_partId_key" ON "CartLine"("userId", "partId");

-- CreateIndex
CREATE INDEX "PriceRule_active_idx" ON "PriceRule"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRule_scope_target_key" ON "PriceRule"("scope", "target");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentContact_party_key" ON "FulfillmentContact"("party");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ImportRun_startedAt_idx" ON "ImportRun"("startedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PartCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_segmentCode_fkey" FOREIGN KEY ("segmentCode") REFERENCES "CodeSegment"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
