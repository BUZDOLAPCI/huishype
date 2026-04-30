import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../../../db/index.js';
import { canonicalListings, userFollows, users } from '../../../db/schema.js';
import { generateAccessToken } from '../../../plugins/auth.js';

// Shared builders for integration suites that create and clean up their own
// rows instead of relying on ambient seeded property/listing data.

type PropertyStatus = 'active' | 'inactive' | 'demolished';
type ListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';

interface CreateUserOptions {
  label: string;
}

interface CreatePropertyOptions {
  id?: string;
  countryCode?: string;
  nationalId?: string | null;
  street?: string;
  houseNumber?: number;
  houseNumberAddition?: string | null;
  city?: string;
  region?: string | null;
  postalCode?: string;
  status?: PropertyStatus;
  lon?: number;
  lat?: number;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
}

interface CreateListingOptions {
  id?: string;
  propertyId: string;
  sourceName?: string;
  sourceUrl?: string;
  status?: ListingStatus;
  askingPrice?: number | null;
  thumbnailUrl?: string | null;
  priceType?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  verificationState?: 'provisional' | 'validated' | 'invalid' | 'validation_pending' | 'validation_blocked' | 'validation_failed';
  originSummary?: 'user' | 'mirror' | 'user_and_mirror';
  submittedBy?: string | null;
}

interface CreateCanonicalListingOptions extends CreateListingOptions {
  canonicalUrl?: string | null;
  displayUrl?: string | null;
  primarySourceListingId?: string | null;
}

type CanonicalListingStatusSource = 'mirror' | 'user' | 'system';

interface CreatePriceHistoryOptions {
  id?: string;
  propertyId: string;
  listingId: string;
  price: number;
  priceDate?: Date;
  eventType: string;
  source: string;
  createdAt?: Date;
}

interface CreateOsmBuildingRectangleOptions {
  osmId?: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface CreateFollowOptions {
  followerUserId: string;
  followedUserId: string;
  createdAt?: Date;
}

let fixtureSequence = 0;

function normalizeFixtureIdentifier(label: string, maxLength: number) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

function nextFixtureSuffix(label: string) {
  fixtureSequence += 1;
  const normalizedLabel = normalizeFixtureIdentifier(label, 24) || 'fixture';
  return `${normalizedLabel}-${Date.now()}-${process.pid}-${fixtureSequence}`;
}

function normalizeHouseNumberAddition(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized === '' ? null : normalized;
}

export async function createIntegrationUser(app: FastifyInstance, options: CreateUserOptions) {
  // Integration fixtures only need a persisted user row plus a valid JWT. Do
  // not route this through OAuth, otherwise unrelated auth/profile changes can
  // break suites that are only exercising downstream API behavior.
  const suffix = nextFixtureSuffix(options.label);
  const username = suffix.slice(0, 50);
  const emailLocalPart = suffix.slice(0, 64);
  const googleId = `fixture-google-${suffix}`.slice(0, 255);
  const displayName = options.label.slice(0, 100) || 'Fixture User';

  const [user] = await db
    .insert(users)
    .values({
      googleId,
      email: `${emailLocalPart}@gmail.com`,
      username,
      displayName,
    })
    .returning({ id: users.id });

  return {
    userId: user.id,
    accessToken: generateAccessToken(app, user.id),
  };
}

export async function createIntegrationProperty(options: CreatePropertyOptions = {}) {
  const suffix = nextFixtureSuffix(options.street ?? 'fixture-street');
  const property = {
    id: options.id ?? crypto.randomUUID(),
    countryCode: options.countryCode ?? 'NL',
    nationalId: options.nationalId ?? null,
    street: options.street ?? `Fixture Street ${suffix}`.slice(0, 255),
    houseNumber: options.houseNumber ?? 1,
    houseNumberAddition: normalizeHouseNumberAddition(options.houseNumberAddition),
    city: options.city ?? 'Fixture City',
    region: options.region ?? null,
    postalCode: options.postalCode ?? '1234AB',
    status: options.status ?? 'active',
    lon: options.lon ?? 5.47,
    lat: options.lat ?? 51.44,
    officialValuation: options.officialValuation ?? null,
    officialValuationYear: options.officialValuationYear ?? null,
    yearBuilt: options.yearBuilt ?? null,
    floorAreaM2: options.floorAreaM2 ?? null,
  };

  await db.execute(sql`
    INSERT INTO properties (
      id,
      country_code,
      national_id,
      street,
      house_number,
      house_number_addition,
      city,
      region,
      postal_code,
      status,
      geometry,
      official_valuation,
      official_valuation_year,
      year_built,
      floor_area_m2
    )
    VALUES (
      ${property.id},
      ${property.countryCode},
      ${property.nationalId},
      ${property.street},
      ${property.houseNumber},
      ${property.houseNumberAddition},
      ${property.city},
      ${property.region},
      ${property.postalCode},
      ${property.status},
      ST_SetSRID(ST_MakePoint(${property.lon}, ${property.lat}), 4326),
      ${property.officialValuation},
      ${property.officialValuationYear},
      ${property.yearBuilt},
      ${property.floorAreaM2}
    )
  `);

  return property;
}

export async function createIntegrationListing(options: CreateListingOptions) {
  const createdAt = options.createdAt ?? new Date();
  const updatedAt = options.updatedAt ?? createdAt;

  const listing = {
    id: options.id ?? crypto.randomUUID(),
    propertyId: options.propertyId,
    sourceName: options.sourceName ?? 'funda',
    sourceUrl:
      options.sourceUrl ?? `https://example.com/listing-${options.propertyId}-${crypto.randomUUID()}`,
    status: options.status ?? 'active',
    askingPrice: options.askingPrice ?? null,
    thumbnailUrl: options.thumbnailUrl ?? null,
    priceType: options.priceType ?? 'sale',
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };

  await db.execute(sql`
    INSERT INTO listings (
      id,
      property_id,
      source_name,
      source_url,
      status,
      asking_price,
      thumbnail_url,
      price_type,
      created_at,
      updated_at
    )
    VALUES (
      ${listing.id},
      ${listing.propertyId},
      ${listing.sourceName},
      ${listing.sourceUrl},
      ${listing.status},
      ${listing.askingPrice},
      ${listing.thumbnailUrl},
      ${listing.priceType},
      ${listing.createdAt},
      ${listing.updatedAt}
    )
  `);

  await createIntegrationCanonicalListing({
    ...options,
    id: listing.id,
    propertyId: listing.propertyId,
    sourceName: listing.sourceName,
    sourceUrl: listing.sourceUrl,
    status: listing.status,
    askingPrice: listing.askingPrice,
    thumbnailUrl: listing.thumbnailUrl,
    priceType: listing.priceType,
    createdAt,
    updatedAt,
  });

  return listing;
}

export async function createIntegrationCanonicalListing(options: CreateCanonicalListingOptions) {
  const createdAt = options.createdAt ?? new Date();
  const updatedAt = options.updatedAt ?? createdAt;
  const sourceName = options.sourceName ?? 'funda';
  const canonicalUrl =
    options.canonicalUrl ??
    options.sourceUrl ??
    `https://example.com/canonical-listing-${options.propertyId}-${crypto.randomUUID()}`;
  const statusSource: CanonicalListingStatusSource =
    options.originSummary === 'user' ? 'user' : 'mirror';

  const listing = {
    id: options.id ?? crypto.randomUUID(),
    propertyId: options.propertyId,
    sourceName,
    primarySourceListingId: options.primarySourceListingId ?? null,
    canonicalUrl,
    displayUrl: options.displayUrl ?? canonicalUrl,
    status: options.status ?? 'active',
    statusSource,
    verificationState: options.verificationState ?? 'provisional',
    originSummary: options.originSummary ?? 'mirror',
    submittedBy: options.submittedBy ?? null,
    askingPrice: options.askingPrice ?? null,
    thumbnailUrl: options.thumbnailUrl ?? null,
    priceCurrency: 'EUR',
    priceType: options.priceType ?? 'sale',
    firstSeenAt: createdAt,
    lastSeenAt: updatedAt,
    lastMirrorSeenAt: options.originSummary === 'user' ? null : updatedAt,
    lastUserSeenAt: options.originSummary === 'user' ? updatedAt : null,
    lastReconciledAt: updatedAt,
    createdAt,
    updatedAt,
  };

  await db
    .insert(canonicalListings)
    .values(listing)
    .onConflictDoUpdate({
      target: canonicalListings.id,
      set: {
        status: listing.status,
        verificationState: listing.verificationState,
        askingPrice: listing.askingPrice,
        thumbnailUrl: listing.thumbnailUrl,
        priceType: listing.priceType,
        lastSeenAt: listing.lastSeenAt,
        lastMirrorSeenAt: listing.lastMirrorSeenAt,
        lastUserSeenAt: listing.lastUserSeenAt,
        lastReconciledAt: listing.lastReconciledAt,
        updatedAt: listing.updatedAt,
      },
    });

  return {
    ...listing,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function createIntegrationPriceHistory(options: CreatePriceHistoryOptions) {
  const priceDate = options.priceDate ?? new Date();
  const createdAt = options.createdAt ?? new Date();
  const priceHistory = {
    id: options.id ?? crypto.randomUUID(),
    propertyId: options.propertyId,
    listingId: options.listingId,
    price: options.price,
    priceDate: priceDate.toISOString(),
    eventType: options.eventType,
    source: options.source,
    createdAt: createdAt.toISOString(),
  };

  await db.execute(sql`
    INSERT INTO price_history (
      id,
      property_id,
      listing_id,
      price,
      price_date,
      event_type,
      source,
      created_at
    )
    VALUES (
      ${priceHistory.id},
      ${priceHistory.propertyId},
      ${priceHistory.listingId},
      ${priceHistory.price},
      ${priceHistory.priceDate},
      ${priceHistory.eventType},
      ${priceHistory.source},
      ${priceHistory.createdAt}
    )
  `);

  return priceHistory;
}

export async function createIntegrationOsmBuildingRectangle(
  options: CreateOsmBuildingRectangleOptions,
) {
  const osmId = options.osmId ?? Number(`8${Date.now()}`.slice(0, 12));

  await db.execute(sql`
    INSERT INTO osm_buildings (osm_id, geometry)
    VALUES (
      ${osmId},
      ST_GeomFromText(
        ${`MULTIPOLYGON(((${options.minLon} ${options.minLat}, ${options.maxLon} ${options.minLat}, ${options.maxLon} ${options.maxLat}, ${options.minLon} ${options.maxLat}, ${options.minLon} ${options.minLat})))`},
        4326
      )
    )
  `);

  return { osmId };
}

export async function createIntegrationFollow(options: CreateFollowOptions) {
  const createdAt = options.createdAt ?? new Date();

  await db
    .insert(userFollows)
    .values({
      followerUserId: options.followerUserId,
      followedUserId: options.followedUserId,
      createdAt,
    })
    .onConflictDoNothing();

  return {
    followerUserId: options.followerUserId,
    followedUserId: options.followedUserId,
    createdAt: createdAt.toISOString(),
  };
}

export async function refreshIntegrationMapProjection(propertyIds: string | string[]) {
  const ids = Array.isArray(propertyIds) ? propertyIds : [propertyIds];
  if (ids.length === 0) {
    return;
  }

  const requestedValues = sql.join(ids.map((id) => sql`(${id}::uuid)`), sql`, `);
  const requestedSubquery = sql`SELECT property_id FROM (VALUES ${requestedValues}) AS requested(property_id)`;

  await db.execute(sql`
    DELETE FROM map_public_property_bucket_members
    WHERE property_id IN (${requestedSubquery})
  `);
  await db.execute(sql`
    DELETE FROM map_property_actor_activity
    WHERE property_id IN (${requestedSubquery})
  `);
  await db.execute(sql`
    DELETE FROM map_quiet_property_points
    WHERE property_id IN (${requestedSubquery})
  `);
  await db.execute(sql`
    DELETE FROM map_public_property_facts
    WHERE property_id IN (${requestedSubquery})
  `);

  await db.execute(sql`
    WITH requested(property_id) AS (
      VALUES ${requestedValues}
    ),
    listing_ordered AS MATERIALIZED (
      SELECT
        l.*,
        ROW_NUMBER() OVER (
          PARTITION BY l.property_id
          ORDER BY l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
        ) AS latest_rank,
        CASE
          WHEN l.status = 'active' THEN ROW_NUMBER() OVER (
            PARTITION BY l.property_id, (l.status = 'active')
            ORDER BY l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
          )
          ELSE NULL
        END AS active_rank,
        CASE
          WHEN l.thumbnail_url IS NOT NULL THEN ROW_NUMBER() OVER (
            PARTITION BY l.property_id, (l.thumbnail_url IS NOT NULL)
            ORDER BY (l.status = 'active') DESC, l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
          )
          ELSE NULL
        END AS thumbnail_rank
      FROM v_canonical_listing_facts l
      INNER JOIN requested r ON r.property_id = l.property_id
    ),
    listing_agg AS MATERIALIZED (
      SELECT
        l.property_id,
        COUNT(*) FILTER (WHERE l.status = 'active')::int AS active_listing_count,
        COUNT(*) FILTER (WHERE l.status IN ('sold', 'rented'))::int AS completed_listing_count,
        MAX(l.status) FILTER (WHERE l.latest_rank = 1) AS latest_status,
        MAX(l.normalized_price_type) FILTER (WHERE l.active_rank = 1) AS active_price_type,
        MAX(l.asking_price) FILTER (WHERE l.active_rank = 1) AS asking_price,
        MAX(l.thumbnail_url) FILTER (WHERE l.thumbnail_rank = 1) AS thumbnail_url
      FROM listing_ordered l
      GROUP BY l.property_id
    ),
    comment_facts AS MATERIALIZED (
      SELECT
        c.property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE c.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
        MAX(c.created_at) AS latest
      FROM comments c
      INNER JOIN requested r ON r.property_id = c.property_id
      GROUP BY c.property_id
    ),
    property_like_facts AS MATERIALIZED (
      SELECT
        r.target_id AS property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE r.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
        MAX(r.created_at) AS latest
      FROM reactions r
      INNER JOIN requested requested ON requested.property_id = r.target_id
      WHERE r.target_type = 'property'
        AND r.reaction_type = 'like'
      GROUP BY r.target_id
    ),
    comment_like_facts AS MATERIALIZED (
      SELECT
        c.property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE r.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
        MAX(r.created_at) AS latest
      FROM reactions r
      INNER JOIN comments c ON c.id = r.target_id
      INNER JOIN requested requested ON requested.property_id = c.property_id
      WHERE r.target_type = 'comment'
        AND r.reaction_type = 'like'
      GROUP BY c.property_id
    ),
    property_facts AS MATERIALIZED (
      SELECT
        p.id AS property_id,
        p.country_code,
        ST_Transform(p.geometry, 3857) AS geom_3857,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat,
        CONCAT_WS(
          ' ',
          p.street,
          CONCAT(p.house_number::text, COALESCE(NULLIF(BTRIM(p.house_number_addition), ''), ''))
        ) AS address,
        p.city,
        COALESCE(la.active_listing_count, 0)::int AS active_listing_count,
        COALESCE(la.completed_listing_count, 0)::int AS completed_listing_count,
        (
          COALESCE(cf.count, 0)
          + COALESCE(plf.count, 0)
          + COALESCE(clf.count, 0)
        )::int AS social_count,
        (
          COALESCE(cf.recent_count, 0)
          + COALESCE(plf.recent_count, 0)
          + COALESCE(clf.recent_count, 0)
        )::int AS recent_social_count,
        (
          COALESCE(cf.count, 0)::double precision
          + COALESCE(plf.count, 0)::double precision
          + COALESCE(clf.count, 0)::double precision * 0.8
        )::real AS social_score_total,
        (
          COALESCE(cf.recent_count, 0)::double precision
          + COALESCE(plf.recent_count, 0)::double precision
          + COALESCE(clf.recent_count, 0)::double precision * 0.8
        )::real AS recent_social_score_total,
        COALESCE(cf.count, 0)::int AS comment_count,
        la.asking_price,
        CASE
          WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'sale'
            THEN la.asking_price
          ELSE p.official_valuation
        END AS sale_effective_price,
        CASE
          WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'rent'
            THEN la.asking_price
          ELSE NULL
        END AS rent_effective_price,
        la.thumbnail_url,
        COALESCE(la.active_listing_count, 0) > 0 AS has_active_listing,
        CASE
          WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'rent'
            THEN 'for-rent'
          WHEN COALESCE(la.active_listing_count, 0) > 0
            THEN 'for-sale'
          WHEN la.latest_status = 'sold'
            THEN 'sold'
          WHEN la.latest_status = 'rented'
            THEN 'rented'
          ELSE 'not-listed'
        END AS market_state,
        GREATEST(cf.latest, plf.latest, clf.latest) AS last_social_at
      FROM properties p
      INNER JOIN requested r ON r.property_id = p.id
      LEFT JOIN listing_agg la ON la.property_id = p.id
      LEFT JOIN comment_facts cf ON cf.property_id = p.id
      LEFT JOIN property_like_facts plf ON plf.property_id = p.id
      LEFT JOIN comment_like_facts clf ON clf.property_id = p.id
      WHERE p.status = 'active'
        AND p.geometry IS NOT NULL
    )
    INSERT INTO map_public_property_facts (
      property_id,
      country_code,
      geom_3857,
      lon,
      lat,
      address,
      city,
      active_listing_count,
      completed_listing_count,
      social_count,
      recent_social_count,
      social_score_total,
      social_score_max,
      recent_social_score_total,
      comment_count,
      asking_price,
      sale_effective_price,
      rent_effective_price,
      thumbnail_url,
      has_active_listing,
      market_state,
      last_social_at,
      updated_at
    )
    SELECT
      property_id,
      country_code,
      geom_3857,
      lon,
      lat,
      address,
      city,
      active_listing_count,
      completed_listing_count,
      social_count,
      recent_social_count,
      social_score_total,
      social_score_total,
      recent_social_score_total,
      comment_count,
      asking_price,
      sale_effective_price,
      rent_effective_price,
      thumbnail_url,
      has_active_listing,
      market_state,
      last_social_at,
      NOW()
    FROM property_facts
    WHERE active_listing_count > 0
      OR completed_listing_count > 0
      OR social_score_total >= 0.75
  `);

  await db.execute(sql`
    WITH requested(property_id) AS (
      VALUES ${requestedValues}
    )
    INSERT INTO map_quiet_property_points (
      property_id,
      country_code,
      geom_3857,
      lon,
      lat,
      market_state,
      sale_effective_price,
      updated_at
    )
    SELECT
      p.id,
      p.country_code,
      ST_Transform(p.geometry, 3857),
      ST_X(p.geometry),
      ST_Y(p.geometry),
      'not-listed',
      p.official_valuation,
      NOW()
    FROM properties p
    INNER JOIN requested r ON r.property_id = p.id
    LEFT JOIN map_public_property_facts f ON f.property_id = p.id
    WHERE p.status = 'active'
      AND p.geometry IS NOT NULL
      AND f.property_id IS NULL
  `);

  await db.execute(sql`
    WITH requested(property_id) AS (
      VALUES ${requestedValues}
    ),
    params AS (
      SELECT
        40075016.68557849::double precision AS world_width,
        20037508.342789244::double precision AS world_half
    )
    INSERT INTO map_public_property_bucket_members (zoom, bucket_x, bucket_y, property_id)
    SELECT
      z.zoom,
      FLOOR((ST_X(f.geom_3857) + params.world_half) / ((params.world_width / POWER(2.0, z.zoom)) / 16.0))::integer,
      FLOOR((params.world_half - ST_Y(f.geom_3857)) / ((params.world_width / POWER(2.0, z.zoom)) / 16.0))::integer,
      f.property_id
    FROM map_public_property_facts f
    INNER JOIN requested r ON r.property_id = f.property_id
    CROSS JOIN generate_series(0, 16) AS z(zoom)
    CROSS JOIN params
  `);

  await db.execute(sql`
    WITH requested(property_id) AS (
      VALUES ${requestedValues}
    )
    INSERT INTO map_property_actor_activity (
      property_id,
      actor_user_id,
      activity_kind,
      activity_at,
      score,
      geom_3857
    )
    SELECT c.property_id, c.user_id, 'comment', c.created_at, 1.0::real, ST_Transform(p.geometry, 3857)
    FROM comments c
    INNER JOIN requested r ON r.property_id = c.property_id
    INNER JOIN properties p ON p.id = c.property_id
    WHERE p.geometry IS NOT NULL
    UNION ALL
    SELECT reactions.target_id, reactions.user_id, 'property_like', reactions.created_at, 1.0::real, ST_Transform(p.geometry, 3857)
    FROM reactions
    INNER JOIN requested r ON r.property_id = reactions.target_id
    INNER JOIN properties p ON p.id = reactions.target_id
    WHERE reactions.target_type = 'property'
      AND reactions.reaction_type = 'like'
      AND p.geometry IS NOT NULL
  `);
}

export async function refreshLatestActiveListingsView() {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);
}

export function tileCoordinatesForPoint(lon: number, lat: number, z: number) {
  const latRad = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * Math.pow(2, z)),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z),
    ),
  };
}
