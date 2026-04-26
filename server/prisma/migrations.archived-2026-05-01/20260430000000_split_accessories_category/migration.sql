-- Split the legacy "Accessories" category into "Computer Accessories" and
-- "Mobile Accessories". Existing rows default to "Computer Accessories"
-- (the catch-all for keyboards, mice, docks, printers/scanners, etc).
-- Sellers can re-categorize specific items via the listing edit form if
-- they belong in mobile.
UPDATE "Listing" SET "category" = 'Computer Accessories' WHERE "category" = 'Accessories';
