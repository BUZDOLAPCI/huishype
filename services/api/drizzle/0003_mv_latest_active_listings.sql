-- Materialized view: pre-computed "latest active listing per property".
-- Replaces the inline DISTINCT ON subquery in the feed endpoint, avoiding
-- a full listings table scan on every request.
--
-- Unique index on property_id is required for runtime REFRESH CONCURRENTLY.
-- The CREATE MATERIALIZED VIEW statement below already populates the view.
-- Runtime refreshes happen outside the migrator transaction.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_latest_active_listings AS
SELECT DISTINCT ON (property_id)
  property_id, asking_price, thumbnail_url,
  created_at AS listed_at
FROM listings
WHERE status = 'active'
ORDER BY property_id, created_at DESC;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_latest_active_listings_property
ON mv_latest_active_listings (property_id);--> statement-breakpoint
