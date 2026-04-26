-- CreateTable
CREATE TABLE "SquareCategoryLink" (
    "id" TEXT NOT NULL,
    "squareMerchantId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "squareCategoryId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquareCategoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareCategoryLink_squareMerchantId_idx" ON "SquareCategoryLink"("squareMerchantId");

-- CreateIndex
CREATE UNIQUE INDEX "SquareCategoryLink_squareMerchantId_name_key" ON "SquareCategoryLink"("squareMerchantId", "name");
