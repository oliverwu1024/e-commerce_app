-- CreateIndex
CREATE INDEX "Listing_status_createdAt_idx" ON "Listing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_status_category_idx" ON "Listing"("status", "category");

-- CreateIndex
CREATE INDEX "Listing_status_price_idx" ON "Listing"("status", "price");

-- CreateIndex
CREATE INDEX "Listing_sellerId_idx" ON "Listing"("sellerId");
