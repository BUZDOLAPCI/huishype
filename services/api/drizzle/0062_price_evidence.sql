-- A listing's asking amount and a terminal status are independent facts. Unknown
-- historical amounts must never become verified transaction prices by default.
ALTER TABLE price_history ADD COLUMN price_kind varchar(10) NOT NULL DEFAULT 'unknown';
ALTER TABLE price_history ADD CONSTRAINT price_history_price_kind_check
  CHECK (price_kind IN ('asking', 'achieved', 'unknown'));
ALTER TABLE listing_price_observations ADD COLUMN price_kind varchar(10) NOT NULL DEFAULT 'unknown';
ALTER TABLE listing_price_observations ADD CONSTRAINT listing_price_observations_price_kind_check
  CHECK (price_kind IN ('asking', 'achieved', 'unknown'));
--> statement-breakpoint
CREATE TABLE price_evidence_repair_queue (
  property_id uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  derived_recomputed_at timestamptz
);
-- Includes ambiguous rows: their exclusion can revoke old scores even if the
-- amount itself cannot be positively reclassified.
INSERT INTO price_evidence_repair_queue (property_id)
SELECT DISTINCT property_id FROM price_history WHERE event_type IN ('sold', 'rented');
--> statement-breakpoint
DROP INDEX price_history_dedup_idx;
CREATE UNIQUE INDEX price_history_dedup_idx
  ON price_history (property_id, price_date, price, event_type, price_kind);
DROP INDEX listing_price_observations_source_dedup_idx;
CREATE UNIQUE INDEX listing_price_observations_source_dedup_idx
  ON listing_price_observations
    (canonical_listing_id, source_name, source_listing_id, price_date, price, event_type, price_kind)
  WHERE source_listing_id IS NOT NULL;
--> statement-breakpoint
UPDATE listing_price_observations SET price_kind = 'asking'
WHERE event_type::text IN ('initial', 'asking_price', 'price_change', 'mirror_refresh', 'user_submission');
UPDATE price_history SET price_kind = 'asking'
WHERE event_type IN ('asking_price', 'price_change', 'listed');
--> statement-breakpoint
-- This is the identifiable buggy projection: current asking_price was copied
-- to a synthetic status_change on the observation day. Legacy migration rows
-- and explicit source history are excluded; equality of amounts alone is not
-- evidence that a historical transaction amount was an asking price.
UPDATE listing_price_observations lpo
SET price_kind = 'asking'
FROM listing_observations lo
WHERE lo.id = lpo.listing_observation_id
  AND lpo.price_kind = 'unknown'
  AND lpo.event_type::text = 'status_change'
  AND lo.source_status::text IN ('sold', 'rented')
  AND lpo.price = lo.asking_price
  AND lpo.price_date = (lo.observed_at AT TIME ZONE 'UTC')::date
  AND NOT (lo.payload ? 'legacy_listing_id')
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(lo.payload->'priceHistory') = 'array'
        THEN lo.payload->'priceHistory' ELSE '[]'::jsonb END
    ) entry
    WHERE entry->>'eventType' IN ('status_change', 'sold', 'rented')
      AND entry->>'priceDate' = lpo.price_date::text
      AND entry->>'price' = lpo.price::text
  );
--> statement-breakpoint
UPDATE price_history ph SET price_kind = 'asking'
WHERE ph.event_type IN ('sold', 'rented')
  AND ph.price_kind = 'unknown'
  AND EXISTS (
    SELECT 1 FROM listing_price_observations lpo
    JOIN listing_observations lo ON lo.id = lpo.listing_observation_id
    WHERE lpo.property_id = ph.property_id AND lpo.source_name = ph.source
      AND lpo.price_date = ph.price_date AND lpo.price = ph.price
      AND lpo.event_type::text = 'status_change' AND lpo.price_kind = 'asking'
      AND lo.source_status::text = ph.event_type
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_price_observations other
    WHERE other.property_id = ph.property_id AND other.source_name = ph.source
      AND other.price_date = ph.price_date AND other.price = ph.price
      AND other.event_type::text IN ('status_change', 'sold', 'rented')
      AND other.price_kind <> 'asking'
  );
--> statement-breakpoint
-- Preserve the price once when correcting an artificial sold-price row that
-- duplicates asking history. The original observation evidence is retained.
DELETE FROM price_history wrong
USING price_history asking
WHERE wrong.price_kind = 'asking' AND wrong.event_type IN ('sold', 'rented')
  AND asking.price_kind = 'asking' AND asking.event_type = 'asking_price'
  AND asking.property_id = wrong.property_id AND asking.price_date = wrong.price_date
  AND asking.price = wrong.price;
-- Collapse sold/rented duplicates too before assigning the same asking event.
DELETE FROM price_history duplicate
USING price_history kept
WHERE duplicate.price_kind = 'asking' AND duplicate.event_type IN ('sold', 'rented')
  AND kept.price_kind = 'asking' AND kept.event_type IN ('sold', 'rented')
  AND duplicate.property_id = kept.property_id AND duplicate.price_date = kept.price_date
  AND duplicate.price = kept.price AND duplicate.id > kept.id;
UPDATE price_history SET event_type = 'asking_price'
WHERE price_kind = 'asking' AND event_type IN ('sold', 'rented');
