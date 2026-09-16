-- AlterTable
ALTER TABLE "Dealer" ADD COLUMN     "gstExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provincialExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxExemptNumber" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "subtotalCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRegionCode" TEXT,
ADD COLUMN     "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PricingSettings" DROP COLUMN "taxNote",
DROP COLUMN "taxRatePct",
ADD COLUMN     "chargeTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "qstNumber" TEXT;

-- CreateTable
CREATE TABLE "TaxRegion" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hstThou" INTEGER,
    "gstThou" INTEGER,
    "provincialThou" INTEGER,
    "provincialLabel" TEXT,
    "collectProvincial" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRegion_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "OrderTax" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rateThou" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTax_orderId_idx" ON "OrderTax"("orderId");

-- AddForeignKey
ALTER TABLE "OrderTax" ADD CONSTRAINT "OrderTax_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

