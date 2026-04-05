-- Composite indexes for per-property detail queries (comments list,
-- guess history, property likes) and materialized view refresh.
-- These accelerate per-property lookups with reverse-chronological ordering.

-- Comments: per-property lookups with date ordering (e.g. GET /properties/:id/comments)
CREATE INDEX IF NOT EXISTS idx_comments_property_created
ON comments(property_id, created_at DESC);--> statement-breakpoint

-- Price guesses: same pattern (e.g. GET /properties/:id/guesses)
CREATE INDEX IF NOT EXISTS idx_price_guesses_property_created
ON price_guesses(property_id, created_at DESC);--> statement-breakpoint

-- Reactions: partial index for property likes (most common reaction query)
CREATE INDEX IF NOT EXISTS idx_reactions_property_like
ON reactions(target_id, created_at DESC)
WHERE target_type = 'property' AND reaction_type = 'like';--> statement-breakpoint

-- Listings: speeds up DISTINCT ON inside mv_latest_active_listings REFRESH.
-- The feed endpoint reads from the MV, not this table directly.
CREATE INDEX IF NOT EXISTS idx_listings_active_property
ON listings(property_id, created_at DESC)
WHERE status = 'active';
