-- Structured seller address. Existing rows have NULLs (no backfill from
-- the legacy `location` free-form field — too unreliable to parse). The API
-- layer gates listing creation on these being filled, so existing sellers
-- will be prompted to complete their profile next time they list.
ALTER TABLE "User"
  ADD COLUMN "addressLine1" VARCHAR(200),
  ADD COLUMN "addressLine2" VARCHAR(200),
  ADD COLUMN "suburb"       VARCHAR(100),
  ADD COLUMN "postcode"     VARCHAR(10),
  ADD COLUMN "state"        VARCHAR(50),
  ADD COLUMN "country"      VARCHAR(100),
  ADD COLUMN "showFullAddressPublicly" BOOLEAN NOT NULL DEFAULT false;
