-- Indexes supporting GET /api/orders/sales, /purchases, and /:id/messages
-- Compound indexes match the (filter, ORDER BY createdAt DESC) shape of those queries.
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt");
CREATE INDEX "Order_listingId_idx" ON "Order"("listingId");
CREATE INDEX "Message_orderId_createdAt_idx" ON "Message"("orderId", "createdAt");
