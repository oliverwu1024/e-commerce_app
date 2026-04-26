-- Standalone listingId indexes so listing-side joins and cascades don't
-- full-scan. The composite uniques (cartId,listingId) and (userId,listingId)
-- are useless for listingId-only lookups.
CREATE INDEX IF NOT EXISTS "CartItem_listingId_idx" ON "CartItem"("listingId");
CREATE INDEX IF NOT EXISTS "SavedListing_listingId_idx" ON "SavedListing"("listingId");

-- Review gains updatedAt for consistency with every other mutable model.
-- Backfill existing rows to createdAt so the NOT NULL constraint passes.
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "Review" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "Review" ALTER COLUMN "updatedAt" SET NOT NULL;
