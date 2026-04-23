DO $$
BEGIN
  CREATE TYPE "listing_source_id_kind" AS ENUM ('tiny_id', 'global_id', 'detail_id', 'canonical_path', 'relative_path', 'url_path', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_observation_origin" AS ENUM ('user', 'mirror', 'replay', 'validation');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_property_match_kind" AS ENUM ('user_selected', 'source_exact', 'source_spatial', 'source_unmatched', 'source_mismatch');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_source_status" AS ENUM ('available', 'sold', 'rented', 'withdrawn', 'not_found', 'blocked', 'invalid', 'parser_error', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_source_alias_kind" AS ENUM ('tiny_id', 'global_id', 'detail_id', 'canonical_url', 'relative_path', 'url_path');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "canonical_listing_status" AS ENUM ('active', 'sold', 'rented', 'withdrawn', 'not_found', 'blocked', 'invalid', 'parser_error', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "canonical_listing_status_source" AS ENUM ('mirror', 'user', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "canonical_listing_verification_state" AS ENUM ('provisional', 'validated', 'invalid', 'validation_pending', 'validation_blocked', 'validation_failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "canonical_listing_origin_summary" AS ENUM ('user', 'mirror', 'user_and_mirror');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_observation_link_reason" AS ENUM ('source_identity', 'source_alias', 'canonical_url', 'user_provisional', 'manual_repair');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "mirror_listing_watch_state" AS ENUM ('pending', 'queued', 'fetching', 'matched', 'not_found', 'blocked', 'invalid', 'parser_error', 'unsupported', 'retryable_error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_price_observation_event_type" AS ENUM ('initial', 'price_change', 'status_change', 'mirror_refresh', 'user_submission');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_source_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "alias_kind" "listing_source_alias_kind" NOT NULL,
  "alias_value" text NOT NULL,
  "primary_source_listing_id" varchar(255) NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_source_aliases_source_alias_idx"
ON "listing_source_aliases" ("source_name", "alias_kind", "alias_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listing_source_aliases_source_primary_alias_idx"
ON "listing_source_aliases" ("source_name", "primary_source_listing_id", "alias_kind", "alias_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_source_aliases_primary_idx"
ON "listing_source_aliases" ("source_name", "primary_source_listing_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "canonical_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "source_name" varchar(50) NOT NULL,
  "primary_source_listing_id" varchar(255),
  "canonical_url" text,
  "display_url" text,
  "status" "canonical_listing_status" DEFAULT 'active' NOT NULL,
  "status_source" "canonical_listing_status_source" DEFAULT 'system' NOT NULL,
  "verification_state" "canonical_listing_verification_state" DEFAULT 'provisional' NOT NULL,
  "origin_summary" "canonical_listing_origin_summary" DEFAULT 'user' NOT NULL,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "thumbnail_url" text,
  "title" text,
  "description" text,
  "asking_price" bigint,
  "price_currency" varchar(3),
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "last_mirror_seen_at" timestamp with time zone,
  "last_user_seen_at" timestamp with time zone,
  "last_reconciled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "canonical_listings_source_identity_idx"
ON "canonical_listings" ("source_name", "primary_source_listing_id")
WHERE "primary_source_listing_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canonical_listings_source_url_idx"
ON "canonical_listings" ("source_name", "canonical_url")
WHERE "canonical_url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_property_id_idx"
ON "canonical_listings" ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_property_status_idx"
ON "canonical_listings" ("property_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_verification_state_idx"
ON "canonical_listings" ("verification_state");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mirror_listing_watches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "source_url_raw" text NOT NULL,
  "source_url_canonical" text NOT NULL,
  "source_listing_id" varchar(255),
  "canonical_listing_id" uuid REFERENCES "canonical_listings"("id") ON DELETE set null,
  "state" "mirror_listing_watch_state" DEFAULT 'pending' NOT NULL,
  "state_reason" varchar(100),
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "last_error" text,
  "last_validation_observation_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mirror_listing_watches_active_url_idx"
ON "mirror_listing_watches" ("source_name", "property_id", "source_url_canonical")
WHERE "state" IN ('pending', 'queued', 'fetching', 'retryable_error');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mirror_listing_watches_state_next_attempt_idx"
ON "mirror_listing_watches" ("state", "next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mirror_listing_watches_canonical_listing_idx"
ON "mirror_listing_watches" ("canonical_listing_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "source_listing_id" varchar(255),
  "source_listing_id_kind" "listing_source_id_kind",
  "source_listing_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_url_raw" text,
  "source_url_canonical" text,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "origin" "listing_observation_origin" NOT NULL,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE set null,
  "property_match_kind" "listing_property_match_kind" DEFAULT 'source_unmatched' NOT NULL,
  "source_status" "listing_source_status" DEFAULT 'unknown' NOT NULL,
  "asking_price" bigint,
  "price_currency" varchar(3),
  "address_raw" text,
  "address_normalized" jsonb,
  "postal_code" varchar(20),
  "house_number" integer,
  "house_number_addition" varchar(50),
  "listed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "source_updated_at" timestamp with time zone,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ingest_batch_id" uuid REFERENCES "ingest_batches"("id") ON DELETE set null,
  "validation_watch_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_observations_mirror_idempotency_idx"
ON "listing_observations" ("source_name", "source_listing_id", "origin", "observed_at")
WHERE "source_listing_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_source_identity_idx"
ON "listing_observations" ("source_name", "source_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_source_url_idx"
ON "listing_observations" ("source_name", "source_url_canonical");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_property_id_idx"
ON "listing_observations" ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_ingest_batch_idx"
ON "listing_observations" ("ingest_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_validation_watch_idx"
ON "listing_observations" ("validation_watch_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_observation_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_listing_id" uuid NOT NULL REFERENCES "canonical_listings"("id") ON DELETE cascade,
  "listing_observation_id" uuid NOT NULL REFERENCES "listing_observations"("id") ON DELETE cascade,
  "link_reason" "listing_observation_link_reason" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_observation_links_observation_idx"
ON "listing_observation_links" ("listing_observation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observation_links_canonical_idx"
ON "listing_observation_links" ("canonical_listing_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_price_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "listing_observation_id" uuid NOT NULL REFERENCES "listing_observations"("id") ON DELETE cascade,
  "canonical_listing_id" uuid NOT NULL REFERENCES "canonical_listings"("id") ON DELETE cascade,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "source_name" varchar(50) NOT NULL,
  "source_listing_id" varchar(255),
  "origin" "listing_observation_origin" NOT NULL,
  "price" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "event_type" "listing_price_observation_event_type" NOT NULL,
  "price_date" date NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_price_observations_source_dedup_idx"
ON "listing_price_observations" ("canonical_listing_id", "source_name", "source_listing_id", "price_date", "price", "event_type")
WHERE "source_listing_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_price_observations_property_idx"
ON "listing_price_observations" ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_price_observations_observation_idx"
ON "listing_price_observations" ("listing_observation_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_replay_staging" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "upstream_run_key" varchar(255) NOT NULL,
  "source_listing_id" varchar(255),
  "source_listing_id_kind" "listing_source_id_kind",
  "source_listing_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_url_raw" text,
  "source_url_canonical" text,
  "source_status" "listing_source_status" DEFAULT 'unknown' NOT NULL,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE set null,
  "property_match_kind" "listing_property_match_kind" DEFAULT 'source_unmatched' NOT NULL,
  "asking_price" bigint,
  "price_currency" varchar(3),
  "address_normalized" jsonb,
  "listed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "source_updated_at" timestamp with time zone,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "listing_replay_staging_run_idx"
ON "listing_replay_staging" ("source_name", "upstream_run_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_replay_staging_source_identity_idx"
ON "listing_replay_staging" ("source_name", "source_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_replay_staging_processed_idx"
ON "listing_replay_staging" ("processed_at");--> statement-breakpoint

INSERT INTO "listing_source_aliases" (
  "source_name",
  "alias_kind",
  "alias_value",
  "primary_source_listing_id",
  "first_seen_at",
  "last_seen_at"
)
SELECT
  l."source_name",
  'tiny_id'::"listing_source_alias_kind",
  l."mirror_listing_id",
  l."mirror_listing_id",
  COALESCE(l."mirror_first_seen_at", l."created_at"),
  COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at")
FROM "listings" l
WHERE lower(l."source_name") = 'funda'
  AND l."mirror_listing_id" IS NOT NULL
ON CONFLICT ("source_name", "alias_kind", "alias_value")
DO UPDATE SET
  "primary_source_listing_id" = EXCLUDED."primary_source_listing_id",
  "last_seen_at" = GREATEST("listing_source_aliases"."last_seen_at", EXCLUDED."last_seen_at");--> statement-breakpoint

INSERT INTO "listing_observations" (
  "source_name",
  "source_listing_id",
  "source_listing_id_kind",
  "source_listing_aliases",
  "source_url_raw",
  "source_url_canonical",
  "submitted_by",
  "origin",
  "property_id",
  "property_match_kind",
  "source_status",
  "asking_price",
  "price_currency",
  "first_seen_at",
  "last_seen_at",
  "source_updated_at",
  "observed_at",
  "payload",
  "created_at"
)
SELECT
  l."source_name",
  l."mirror_listing_id",
  CASE
    WHEN l."mirror_listing_id" IS NULL THEN NULL
    WHEN lower(l."source_name") = 'funda' THEN 'tiny_id'::"listing_source_id_kind"
    WHEN lower(l."source_name") = 'pararius' THEN 'url_path'::"listing_source_id_kind"
    ELSE 'unknown'::"listing_source_id_kind"
  END,
  '[]'::jsonb,
  l."source_url",
  l."source_url",
  l."submitted_by",
  'user'::"listing_observation_origin",
  l."property_id",
  'user_selected'::"listing_property_match_kind",
  CASE
    WHEN l."status" = 'active' THEN 'available'::"listing_source_status"
    ELSE l."status"::text::"listing_source_status"
  END,
  l."asking_price",
  'EUR',
  COALESCE(l."mirror_first_seen_at", l."created_at"),
  COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at"),
  l."mirror_last_changed_at",
  l."created_at",
  jsonb_build_object('legacy_listing_id', l."id", 'legacy_origin', 'user'),
  l."created_at"
FROM "listings" l
WHERE l."submitted_by" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "listing_observations" existing
    WHERE existing."origin" = 'user'
      AND existing."payload"->>'legacy_listing_id' = l."id"::text
  );--> statement-breakpoint

INSERT INTO "listing_observations" (
  "source_name",
  "source_listing_id",
  "source_listing_id_kind",
  "source_listing_aliases",
  "source_url_raw",
  "source_url_canonical",
  "origin",
  "property_id",
  "property_match_kind",
  "source_status",
  "asking_price",
  "price_currency",
  "first_seen_at",
  "last_seen_at",
  "source_updated_at",
  "observed_at",
  "payload",
  "created_at"
)
SELECT
  l."source_name",
  l."mirror_listing_id",
  CASE
    WHEN lower(l."source_name") = 'funda' THEN 'tiny_id'::"listing_source_id_kind"
    WHEN lower(l."source_name") = 'pararius' THEN 'url_path'::"listing_source_id_kind"
    ELSE 'unknown'::"listing_source_id_kind"
  END,
  '[]'::jsonb,
  l."source_url",
  l."source_url",
  'mirror'::"listing_observation_origin",
  l."property_id",
  'source_exact'::"listing_property_match_kind",
  CASE
    WHEN l."status" = 'active' THEN 'available'::"listing_source_status"
    ELSE l."status"::text::"listing_source_status"
  END,
  l."asking_price",
  'EUR',
  COALESCE(l."mirror_first_seen_at", l."created_at"),
  COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at"),
  l."mirror_last_changed_at",
  COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at"),
  jsonb_build_object('legacy_listing_id', l."id", 'legacy_origin', 'mirror'),
  l."created_at"
FROM "listings" l
WHERE l."mirror_listing_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "listing_observations" existing
    WHERE existing."origin" = 'mirror'
      AND existing."payload"->>'legacy_listing_id' = l."id"::text
  )
ON CONFLICT DO NOTHING;--> statement-breakpoint

WITH ranked_legacy AS (
  SELECT DISTINCT ON (l."source_name", COALESCE(l."mirror_listing_id", l."source_url"))
    l.*
  FROM "listings" l
  ORDER BY l."source_name", COALESCE(l."mirror_listing_id", l."source_url"), l."updated_at" DESC, l."created_at" DESC
)
INSERT INTO "canonical_listings" (
  "property_id",
  "source_name",
  "primary_source_listing_id",
  "canonical_url",
  "display_url",
  "status",
  "status_source",
  "verification_state",
  "origin_summary",
  "submitted_by",
  "thumbnail_url",
  "title",
  "asking_price",
  "price_currency",
  "first_seen_at",
  "last_seen_at",
  "last_mirror_seen_at",
  "last_user_seen_at",
  "last_reconciled_at",
  "created_at",
  "updated_at"
)
SELECT
  l."property_id",
  l."source_name",
  l."mirror_listing_id",
  l."source_url",
  l."source_url",
  l."status"::text::"canonical_listing_status",
  CASE WHEN l."mirror_listing_id" IS NOT NULL THEN 'mirror' ELSE 'user' END::"canonical_listing_status_source",
  CASE WHEN l."mirror_listing_id" IS NOT NULL THEN 'validated' ELSE 'provisional' END::"canonical_listing_verification_state",
  CASE
    WHEN l."submitted_by" IS NOT NULL AND l."mirror_listing_id" IS NOT NULL THEN 'user_and_mirror'
    WHEN l."submitted_by" IS NOT NULL THEN 'user'
    ELSE 'mirror'
  END::"canonical_listing_origin_summary",
  l."submitted_by",
  l."thumbnail_url",
  l."og_title",
  l."asking_price",
  'EUR',
  COALESCE(l."mirror_first_seen_at", l."created_at"),
  COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at"),
  CASE WHEN l."mirror_listing_id" IS NOT NULL THEN COALESCE(l."mirror_last_seen_at", l."updated_at", l."created_at") END,
  CASE WHEN l."submitted_by" IS NOT NULL THEN l."created_at" END,
  now(),
  l."created_at",
  l."updated_at"
FROM ranked_legacy l
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "listing_observation_links" (
  "canonical_listing_id",
  "listing_observation_id",
  "link_reason"
)
SELECT
  c."id",
  o."id",
  CASE
    WHEN o."source_listing_id" IS NOT NULL THEN 'source_identity'::"listing_observation_link_reason"
    WHEN o."origin" = 'user' THEN 'user_provisional'::"listing_observation_link_reason"
    ELSE 'canonical_url'::"listing_observation_link_reason"
  END
FROM "listing_observations" o
JOIN "canonical_listings" c
  ON c."source_name" = o."source_name"
  AND (
    (o."source_listing_id" IS NOT NULL AND c."primary_source_listing_id" = o."source_listing_id")
    OR (
      o."source_listing_id" IS NULL
      AND c."canonical_url" = o."source_url_canonical"
      AND c."property_id" = o."property_id"
    )
  )
ON CONFLICT ("listing_observation_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "listing_price_observations" (
  "listing_observation_id",
  "canonical_listing_id",
  "property_id",
  "source_name",
  "source_listing_id",
  "origin",
  "price",
  "currency",
  "event_type",
  "price_date",
  "observed_at",
  "created_at"
)
SELECT
  linked."listing_observation_id",
  linked."canonical_listing_id",
  ph."property_id",
  COALESCE(l."source_name", ph."source"),
  l."mirror_listing_id",
  o."origin",
  ph."price",
  'EUR',
  CASE
    WHEN ph."event_type" = 'price_change' THEN 'price_change'::"listing_price_observation_event_type"
    WHEN ph."event_type" IN ('sold', 'rented') THEN 'status_change'::"listing_price_observation_event_type"
    WHEN o."origin" = 'user' THEN 'user_submission'::"listing_price_observation_event_type"
    ELSE 'initial'::"listing_price_observation_event_type"
  END,
  ph."price_date",
  ph."created_at",
  ph."created_at"
FROM "price_history" ph
LEFT JOIN "listings" l ON l."id" = ph."listing_id"
JOIN LATERAL (
  SELECT
    link."listing_observation_id",
    link."canonical_listing_id"
  FROM "listing_observation_links" link
  JOIN "listing_observations" obs ON obs."id" = link."listing_observation_id"
  WHERE (l."id" IS NOT NULL AND obs."payload"->>'legacy_listing_id' = l."id"::text)
    OR (
      l."id" IS NULL
      AND obs."property_id" = ph."property_id"
      AND obs."asking_price" = ph."price"
    )
  ORDER BY
    CASE obs."origin" WHEN 'mirror' THEN 0 WHEN 'user' THEN 1 ELSE 2 END,
    obs."created_at" DESC
  LIMIT 1
) linked ON true
JOIN "listing_observations" o ON o."id" = linked."listing_observation_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "listing_price_observations" existing
  WHERE existing."canonical_listing_id" = linked."canonical_listing_id"
    AND existing."property_id" = ph."property_id"
    AND existing."price_date" = ph."price_date"
    AND existing."price" = ph."price"
    AND existing."event_type" = CASE
      WHEN ph."event_type" = 'price_change' THEN 'price_change'::"listing_price_observation_event_type"
      WHEN ph."event_type" IN ('sold', 'rented') THEN 'status_change'::"listing_price_observation_event_type"
      WHEN o."origin" = 'user' THEN 'user_submission'::"listing_price_observation_event_type"
      ELSE 'initial'::"listing_price_observation_event_type"
    END
);--> statement-breakpoint

INSERT INTO "price_history" (
  "property_id",
  "listing_id",
  "price",
  "price_date",
  "event_type",
  "source",
  "created_at"
)
SELECT
  lpo."property_id",
  legacy."id",
  lpo."price",
  lpo."price_date",
  CASE
    WHEN lpo."event_type" = 'status_change' THEN
      CASE WHEN c."status" = 'rented' THEN 'rented' ELSE 'sold' END
    WHEN lpo."event_type" = 'price_change' THEN 'price_change'
    ELSE 'asking_price'
  END,
  lpo."source_name",
  lpo."created_at"
FROM "listing_price_observations" lpo
JOIN "canonical_listings" c ON c."id" = lpo."canonical_listing_id"
LEFT JOIN LATERAL (
  SELECT l."id"
  FROM "listings" l
  WHERE l."source_name" = c."source_name"
    AND (
      (c."primary_source_listing_id" IS NOT NULL AND l."mirror_listing_id" = c."primary_source_listing_id")
      OR (c."primary_source_listing_id" IS NULL AND l."source_url" = c."canonical_url")
    )
  ORDER BY l."updated_at" DESC
  LIMIT 1
) legacy ON true
ON CONFLICT ("property_id", "price_date", "price", "event_type") DO NOTHING;--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS "mv_latest_active_listings";--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_latest_active_listings" AS
SELECT DISTINCT ON ("property_id")
  "property_id",
  "asking_price",
  "thumbnail_url",
  COALESCE("first_seen_at", "created_at") AS "listed_at"
FROM "canonical_listings"
WHERE "status" = 'active'
  AND "verification_state" NOT IN ('invalid', 'validation_blocked', 'validation_failed')
ORDER BY "property_id", COALESCE("last_seen_at", "updated_at", "created_at") DESC;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mv_latest_active_listings_property"
ON "mv_latest_active_listings" ("property_id");--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS "mv_price_guess_start_market_summaries";--> statement-breakpoint
DROP VIEW IF EXISTS "v_canonical_listing_facts";--> statement-breakpoint

CREATE OR REPLACE VIEW "v_canonical_listing_facts" AS
SELECT
  c."id" AS "listing_id",
  c."property_id",
  p."country_code",
  c."source_name",
  c."status",
  CASE
    WHEN lower(c."source_name") = 'funda' THEN 'sale'
    ELSE NULL
  END AS "normalized_price_type",
  (
    c."status" = 'active'
    AND lower(c."source_name") = 'funda'
    AND c."asking_price" IS NOT NULL
    AND c."verification_state" NOT IN ('invalid', 'validation_blocked', 'validation_failed')
  ) AS "is_active_sale",
  c."asking_price",
  COALESCE(c."first_seen_at", c."created_at") AS "listed_at",
  NULL::integer AS "living_area_m2"
FROM "canonical_listings" c
JOIN "properties" p ON p."id" = c."property_id";--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_price_guess_start_market_summaries" AS
WITH sale_facts AS (
  SELECT
    clf."country_code",
    CASE
      WHEN clf."country_code" = 'NL'
        AND regexp_replace(p."postal_code", '\s+', '', 'g') ~ '^[0-9]{4}[[:alpha:]]{2}$'
        THEN nullif(substring(regexp_replace(p."postal_code", '\s+', '', 'g') from 1 for 4), '')
      ELSE NULL
    END AS "postal_scope_key",
    lower(btrim(p."city")) AS "city_scope_key",
    lower(btrim(p."region")) AS "region_scope_key",
    p."official_valuation",
    COALESCE(clf."living_area_m2", p."floor_area_m2") AS "comparable_area_m2",
    clf."asking_price"
  FROM "v_canonical_listing_facts" clf
  JOIN "properties" p ON p."id" = clf."property_id"
  WHERE lower(clf."source_name") = 'funda'
    AND clf."normalized_price_type" = 'sale'
    AND clf."status" = 'active'
    AND clf."asking_price" BETWEEN 50000 AND 2000000
    AND nullif(btrim(clf."country_code"), '') IS NOT NULL
),
scoped_facts AS (
  SELECT
    "country_code",
    'postal_prefix'::text AS "scope_type",
    "postal_scope_key" AS "scope_key",
    8 AS "minimum_sample_size",
    "official_valuation",
    "comparable_area_m2",
    "asking_price"
  FROM sale_facts
  WHERE "postal_scope_key" IS NOT NULL

  UNION ALL

  SELECT
    "country_code",
    'city'::text AS "scope_type",
    "city_scope_key" AS "scope_key",
    20 AS "minimum_sample_size",
    "official_valuation",
    "comparable_area_m2",
    "asking_price"
  FROM sale_facts
  WHERE "city_scope_key" IS NOT NULL AND "city_scope_key" <> ''

  UNION ALL

  SELECT
    "country_code",
    'region'::text AS "scope_type",
    "region_scope_key" AS "scope_key",
    40 AS "minimum_sample_size",
    "official_valuation",
    "comparable_area_m2",
    "asking_price"
  FROM sale_facts
  WHERE "region_scope_key" IS NOT NULL AND "region_scope_key" <> ''

  UNION ALL

  SELECT
    "country_code",
    'country'::text AS "scope_type",
    "country_code" AS "scope_key",
    100 AS "minimum_sample_size",
    "official_valuation",
    "comparable_area_m2",
    "asking_price"
  FROM sale_facts
)
SELECT
  "country_code",
  "scope_type",
  "scope_key",
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY "asking_price"::numeric / nullif("official_valuation", 0)
  ) FILTER (WHERE "official_valuation" > 0) AS "median_asking_to_official_ratio",
  count(*) FILTER (WHERE "official_valuation" > 0)::integer AS "ratio_sample_size",
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY "asking_price"::numeric / nullif("comparable_area_m2", 0)
  ) FILTER (WHERE "comparable_area_m2" > 0) AS "median_asking_per_m2",
  count(*) FILTER (WHERE "comparable_area_m2" > 0)::integer AS "per_m2_sample_size",
  now() AS "refreshed_at"
FROM scoped_facts
GROUP BY "country_code", "scope_type", "scope_key", "minimum_sample_size"
HAVING
  count(*) FILTER (WHERE "official_valuation" > 0) >= "minimum_sample_size"
  OR count(*) FILTER (WHERE "comparable_area_m2" > 0) >= "minimum_sample_size";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mv_price_guess_start_market_summaries_unique"
ON "mv_price_guess_start_market_summaries" ("country_code", "scope_type", "scope_key");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mv_price_guess_start_market_summaries_lookup"
ON "mv_price_guess_start_market_summaries" ("country_code", "scope_type", "scope_key");--> statement-breakpoint
