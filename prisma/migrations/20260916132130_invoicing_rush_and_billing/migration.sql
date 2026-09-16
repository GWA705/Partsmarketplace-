-- AlterTable
ALTER TABLE "Dealer" ADD COLUMN     "billAttn" TEXT,
ADD COLUMN     "billCity" TEXT,
ADD COLUMN     "billCountry" TEXT DEFAULT 'Canada',
ADD COLUMN     "billEmail" TEXT,
ADD COLUMN     "billLine1" TEXT,
ADD COLUMN     "billLine2" TEXT,
ADD COLUMN     "billPostal" TEXT,
ADD COLUMN     "billProvince" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billCity" TEXT,
ADD COLUMN     "billCountry" TEXT,
ADD COLUMN     "billEmail" TEXT,
ADD COLUMN     "billLine1" TEXT,
ADD COLUMN     "billLine2" TEXT,
ADD COLUMN     "billName" TEXT,
ADD COLUMN     "billPostal" TEXT,
ADD COLUMN     "billProvince" TEXT,
ADD COLUMN     "rush" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PricingSettings" ADD COLUMN     "taxNote" TEXT,
ADD COLUMN     "taxRatePct" INTEGER NOT NULL DEFAULT 0;
