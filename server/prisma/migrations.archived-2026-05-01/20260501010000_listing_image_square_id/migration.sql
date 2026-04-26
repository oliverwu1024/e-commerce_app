-- Track Square Catalog image ids on each ListingImage so the catalog
-- sync worker can reuse already-uploaded images on subsequent listing
-- edits instead of re-uploading the same bytes (Square's CreateCatalogImage
-- is multipart and bandwidth-heavy).
--
-- Both columns are nullable so existing rows don't need backfill.

ALTER TABLE "ListingImage"
    ADD COLUMN "squareImageId" VARCHAR(64),
    ADD COLUMN "squareImageUploadedAt" TIMESTAMP(3);
