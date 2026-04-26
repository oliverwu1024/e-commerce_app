-- Add fulfillment options to listings and orders.
-- Existing listings default to PICKUP_ONLY (sellers must opt back into post
-- and explicitly set a shippingPrice). Existing orders default to PICKUP
-- (legacy orders all settled in person; shippingPrice=0).

CREATE TYPE "FulfillmentMethod" AS ENUM ('POST_ONLY', 'PICKUP_ONLY', 'BOTH');
CREATE TYPE "OrderFulfillmentMethod" AS ENUM ('POST', 'PICKUP');

ALTER TABLE "Listing"
  ADD COLUMN "fulfillmentMethod" "FulfillmentMethod" NOT NULL DEFAULT 'PICKUP_ONLY',
  ADD COLUMN "shippingPrice" DECIMAL(10, 2);

ALTER TABLE "Order"
  ADD COLUMN "fulfillmentMethod" "OrderFulfillmentMethod" NOT NULL DEFAULT 'PICKUP',
  ADD COLUMN "shippingPrice" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "shippingAddress" JSONB;
