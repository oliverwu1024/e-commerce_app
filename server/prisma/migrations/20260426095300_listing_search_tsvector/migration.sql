-- Full-text search column on Listing. Replaces ILIKE-based browse search,
-- which becomes O(n) at scale and can't surface relevance.
--
-- Why a STORED generated column rather than a trigger:
--   - Generated columns auto-update on every INSERT/UPDATE without us
--     having to maintain a trigger function.
--   - Postgres 12+ supports `GENERATED ALWAYS AS ... STORED`. The column
--     is materialised on disk so the GIN index can use it directly.
--
-- Why `setweight` on each field:
--   - Title hits get the highest weight (A), brand B, category C,
--     description D. ts_rank uses these weights to order results so that
--     matching the title beats matching deep in the description.
--
-- Language is `english` — fine for Australian English. If we ever onboard
-- non-English sellers we'd swap for `simple` or per-row language.

ALTER TABLE "Listing"
ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("category", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'D')
) STORED;

CREATE INDEX "Listing_searchVector_idx"
    ON "Listing" USING GIN ("searchVector");
