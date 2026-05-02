import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
  pgEnum,
  customType,
  doublePrecision,
  serial,
  real,
  jsonb,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Parse WKB (Well-Known Binary) hex string from PostGIS into coordinates.
 * WKB format for Point with SRID 4326:
 * - Bytes 0-3: Byte order + type with SRID flag
 * - Bytes 4-7: SRID (4326)
 * - Bytes 8-15: X coordinate (double)
 * - Bytes 16-23: Y coordinate (double)
 */
function parseWKBPoint(wkbHex: string): [number, number] | null {
  try {
    // Remove any whitespace and convert to buffer
    const hex = wkbHex.replace(/\s/g, '');
    const buffer = Buffer.from(hex, 'hex');

    // Check if this is a Point with SRID (type = 0x20000001 for little-endian with SRID)
    // First byte is endianness: 01 = little-endian, 00 = big-endian
    const littleEndian = buffer[0] === 0x01;

    // For little-endian WKB with SRID:
    // Offset 0: byte order (1 byte)
    // Offset 1-4: type with SRID flag (4 bytes, Point with SRID = 0x20000001)
    // Offset 5-8: SRID (4 bytes)
    // Offset 9-16: X (8 bytes, double)
    // Offset 17-24: Y (8 bytes, double)
    let offset = 1; // Skip byte order

    // Skip type (4 bytes) - we know it's a Point
    offset += 4;

    // Check if SRID is present (type has SRID flag 0x20000000)
    // For simplicity, check buffer length to determine format
    if (buffer.length >= 25) {
      // Has SRID
      offset += 4; // Skip SRID
    }

    // Read X and Y coordinates
    const x = littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
    const y = littleEndian ? buffer.readDoubleLE(offset + 8) : buffer.readDoubleBE(offset + 8);

    return [x, y];
  } catch (error) {
    console.error('Failed to parse WKB:', error);
    return null;
  }
}

// Custom type for PostGIS geometry
const geometry = customType<{
  data: { type: 'Point'; coordinates: [number, number] };
  driverData: string;
}>({
  dataType() {
    return 'geometry(Point, 4326)';
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.coordinates[0]} ${value.coordinates[1]})`;
  },
  fromDriver(value) {
    // Handle WKT format (e.g., "POINT(5.48 51.43)")
    if (typeof value === 'string' && value.includes('POINT')) {
      const match = value.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);
      if (match) {
        return {
          type: 'Point' as const,
          coordinates: [parseFloat(match[1]), parseFloat(match[2])] as [number, number],
        };
      }
    }

    // Handle WKB hex format (default PostGIS output)
    if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value)) {
      const coords = parseWKBPoint(value);
      if (coords) {
        return {
          type: 'Point' as const,
          coordinates: coords,
        };
      }
    }

    // Return a default value if parsing fails
    console.warn('Failed to parse geometry value:', value?.toString().substring(0, 100));
    return { type: 'Point' as const, coordinates: [0, 0] as [number, number] };
  },
});

// Custom type for PostGIS MultiPolygon geometry (used by osm_buildings, read-only via raw SQL)
const multiPolygonGeometry = customType<{
  data: string; // WKB hex — only accessed via raw SQL in tiles endpoint
  driverData: string;
}>({
  dataType() {
    return 'geometry(MultiPolygon, 4326)';
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return typeof value === 'string' ? value : String(value);
  },
});

const bytea = customType<{
  data: Buffer;
  driverData: Buffer;
}>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
  },
});

// OSM Buildings table (imported from OSM PBF via import-osm-buildings.ts)
export const osmBuildings = pgTable(
  'osm_buildings',
  {
    id: serial('id').primaryKey(),
    osmId: bigint('osm_id', { mode: 'number' }),
    renderHeight: real('render_height').notNull().default(6.0),
    renderMinHeight: real('render_min_height').notNull().default(0.0),
    geometry: multiPolygonGeometry('geometry').notNull(),
  },
  (table) => [
    uniqueIndex('osm_buildings_osm_id_idx').on(table.osmId).where(sql`osm_id IS NOT NULL`),
    index('idx_osm_buildings_geometry').using('gist', table.geometry),
  ]
);

// Enums
export const reactionTypeEnum = pgEnum('reaction_type', ['like', 'love', 'wow', 'angry']);
export const targetTypeEnum = pgEnum('target_type', ['property', 'comment']);
// listing_source changed from enum to varchar(50) for multi-country extensibility
export const propertyStatusEnum = pgEnum('property_status', ['active', 'inactive', 'demolished']);
export const listingStatusEnum = pgEnum('listing_status', ['active', 'sold', 'rented', 'withdrawn']);
export const ingestRunStatusEnum = pgEnum('ingest_run_status', ['in_progress', 'failed', 'completed']);
export const ingestBatchStatusEnum = pgEnum('ingest_batch_status', [
  'accepted',
  'queued',
  'processing',
  'completed',
  'retryable',
  'superseded',
  'failed',
]);
export const listingSourceIdKindEnum = pgEnum('listing_source_id_kind', [
  'tiny_id',
  'global_id',
  'detail_id',
  'canonical_path',
  'relative_path',
  'url_path',
  'unknown',
]);
export const listingObservationOriginEnum = pgEnum('listing_observation_origin', [
  'user',
  'mirror',
  'replay',
  'validation',
]);
export const listingPropertyMatchKindEnum = pgEnum('listing_property_match_kind', [
  'user_selected',
  'source_exact',
  'source_spatial',
  'source_unmatched',
  'source_mismatch',
]);
export const listingSourceStatusEnum = pgEnum('listing_source_status', [
  'available',
  'sold',
  'rented',
  'withdrawn',
  'not_found',
  'blocked',
  'invalid',
  'parser_error',
  'unknown',
]);
export const listingSourceAliasKindEnum = pgEnum('listing_source_alias_kind', [
  'tiny_id',
  'global_id',
  'detail_id',
  'canonical_url',
  'relative_path',
  'url_path',
]);
export const canonicalListingStatusEnum = pgEnum('canonical_listing_status', [
  'active',
  'sold',
  'rented',
  'withdrawn',
  'not_found',
  'blocked',
  'invalid',
  'parser_error',
  'unknown',
]);
export const canonicalListingStatusSourceEnum = pgEnum('canonical_listing_status_source', [
  'mirror',
  'user',
  'system',
]);
export const canonicalListingVerificationStateEnum = pgEnum('canonical_listing_verification_state', [
  'provisional',
  'validated',
  'invalid',
  'validation_pending',
  'validation_blocked',
  'validation_failed',
]);
export const canonicalListingOriginSummaryEnum = pgEnum('canonical_listing_origin_summary', [
  'user',
  'mirror',
  'user_and_mirror',
]);
export const listingObservationLinkReasonEnum = pgEnum('listing_observation_link_reason', [
  'source_identity',
  'source_alias',
  'canonical_url',
  'user_provisional',
  'manual_repair',
]);
export const mirrorListingWatchStateEnum = pgEnum('mirror_listing_watch_state', [
  'pending',
  'queued',
  'fetching',
  'matched',
  'not_found',
  'blocked',
  'invalid',
  'parser_error',
  'unsupported',
  'retryable_error',
]);
export const listingPriceObservationEventTypeEnum = pgEnum('listing_price_observation_event_type', [
  'initial',
  'price_change',
  'status_change',
  'mirror_refresh',
  'user_submission',
]);

// Users table
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleId: varchar('google_id', { length: 255 }).unique(),
    appleId: varchar('apple_id', { length: 255 }).unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    username: varchar('username', { length: 50 }).notNull().unique(),
    displayName: varchar('display_name', { length: 100 }),
    profilePhotoUrl: text('profile_photo_url'),
    karma: integer('karma').notNull().default(0),
    internalKarma: integer('internal_karma').notNull().default(0), // Can go negative for tracking bad actors
    homeCountry: varchar('home_country', { length: 2 }), // ISO 3166-1 alpha-2 country code
    lastDisplayNameChangeAt: timestamp('last_display_name_change_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_google_id_idx').on(table.googleId),
    uniqueIndex('users_apple_id_idx').on(table.appleId),
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_username_idx').on(table.username),
    index('users_username_trgm_idx').using('gin', table.username.op('gin_trgm_ops')),
    index('users_display_name_trgm_idx').using('gin', table.displayName.op('gin_trgm_ops')),
  ]
);

export const refreshTokenRevocations = pgTable(
  'refresh_token_revocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: varchar('token_id', { length: 255 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_token_revocations_token_id_idx').on(table.tokenId),
    index('refresh_token_revocations_user_id_idx').on(table.userId),
    index('refresh_token_revocations_expires_at_idx').on(table.expiresAt),
  ]
);

// Properties table (addresses — multi-country)
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: varchar('country_code', { length: 2 }).notNull().default('NL'), // ISO 3166-1 alpha-2
    nationalId: varchar('national_id', { length: 50 }), // Country-specific ID (e.g. BAG identificatie for NL, Overture GERS UUID)
    street: varchar('street', { length: 255 }).notNull(),
    houseNumber: integer('house_number').notNull(),
    houseNumberAddition: varchar('house_number_addition', { length: 50 }),
    city: varchar('city', { length: 100 }).notNull(),
    region: varchar('region', { length: 255 }), // Province/state/region
    postalCode: varchar('postal_code', { length: 10 }).notNull(),
    geometry: geometry('geometry'),
    yearBuilt: integer('year_built'), // Construction year
    floorAreaM2: integer('floor_area_m2'), // Floor area in m²
    status: propertyStatusEnum('status').notNull().default('active'),
    officialValuation: bigint('official_valuation', { mode: 'number' }), // Fast cache of current official valuation
    officialValuationYear: integer('official_valuation_year'),
    officialValuationVerified: boolean('official_valuation_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('properties_national_id_idx').on(table.countryCode, table.nationalId),
    index('properties_city_idx').on(table.city),
    index('properties_postal_code_idx').on(table.postalCode),
    index('properties_resolve_address_idx').on(
      table.countryCode,
      table.postalCode,
      table.houseNumber,
      table.houseNumberAddition
    ),
    uniqueIndex('properties_address_unique_idx').on(table.countryCode, table.street, table.postalCode, table.houseNumber, table.houseNumberAddition),
    index('properties_created_at_idx').on(table.createdAt),
    index('properties_country_code_idx').on(table.countryCode),
    index('properties_geometry_gist_idx').using('gist', table.geometry),
    index('properties_active_geometry_gist_idx')
      .using('gist', table.geometry)
      .where(sql`status = 'active' AND geometry IS NOT NULL`),
  ]
);

// Listings table (when property is for sale)
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    sourceUrl: text('source_url').notNull(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    thumbnailUrl: text('thumbnail_url'),
    ogTitle: text('og_title'), // Open Graph title
    status: listingStatusEnum('status').notNull().default('active'),
    mirrorListingId: varchar('mirror_listing_id', { length: 50 }),
    priceType: varchar('price_type', { length: 10 }), // 'sale' or 'rent'
    livingAreaM2: integer('living_area_m2'),
    numRooms: integer('num_rooms'),
    energyLabel: varchar('energy_label', { length: 10 }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }), // NULL = system/mirror ingested
    mirrorFirstSeenAt: timestamp('mirror_first_seen_at', { withTimezone: true }),
    mirrorLastChangedAt: timestamp('mirror_last_changed_at', { withTimezone: true }),
    mirrorLastSeenAt: timestamp('mirror_last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('listings_property_id_idx').on(table.propertyId),
    uniqueIndex('listings_source_url_idx').on(table.sourceUrl), // URL dedup
    uniqueIndex('listings_mirror_dedup_idx').on(table.sourceName, table.mirrorListingId).where(sql`mirror_listing_id IS NOT NULL`),
    index('listings_source_status_idx').on(table.sourceName, table.status), // watermark + staleness
    index('listings_mirror_last_changed_idx').on(table.mirrorLastChangedAt), // watermark query
    index('listings_mirror_last_seen_idx').on(table.mirrorLastSeenAt).where(sql`status = 'active'`),
    index('idx_listings_active_property').on(table.propertyId, sql`created_at DESC`).where(sql`status = 'active'`),
  ]
);

// Price History table
export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    price: bigint('price', { mode: 'number' }).notNull(), // whole euros
    priceDate: date('price_date', { mode: 'string' }).notNull(),
    eventType: varchar('event_type', { length: 20 }).notNull(), // asking_price / sold / rented / price_change
    source: varchar('source', { length: 20 }).notNull(), // funda / pararius / observed
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('price_history_property_date_idx').on(table.propertyId, table.priceDate),
    uniqueIndex('price_history_dedup_idx').on(table.propertyId, table.priceDate, table.price, table.eventType),
    index('price_history_listing_idx').on(table.listingId),
    index('price_history_sold_latest_idx')
      .on(table.propertyId, sql`price_date DESC`, sql`created_at DESC`, sql`id DESC`)
      .where(sql`event_type = 'sold'`),
    index('price_history_rented_latest_idx')
      .on(table.propertyId, sql`price_date DESC`, sql`created_at DESC`, sql`id DESC`)
      .where(sql`event_type = 'rented'`),
  ]
);

export const propertyOfficialValuations = pgTable(
  'property_official_valuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    valuation: bigint('valuation', { mode: 'number' }).notNull(),
    valuationYear: integer('valuation_year').notNull(),
    referenceDate: date('reference_date', { mode: 'string' }),
    source: varchar('source', { length: 50 }).notNull(),
    sourceRecordId: varchar('source_record_id', { length: 100 }),
    sourceDatasetVersion: varchar('source_dataset_version', { length: 100 }),
    sourceUrl: text('source_url'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown> | null>(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    origin: varchar('origin', { length: 30 }).notNull().default('server_verified'),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    clientRuntime: varchar('client_runtime', { length: 20 }),
    sourceRequestFingerprint: varchar('source_request_fingerprint', { length: 128 }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_official_valuations_unique_idx').on(
      table.propertyId,
      table.valuationYear,
      table.source
    ),
    index('property_official_valuations_property_year_idx').on(
      table.propertyId,
      table.valuationYear
    ),
    index('property_official_valuations_year_idx').on(table.valuationYear),
    index('property_official_valuations_source_idx').on(table.source),
  ]
);

export const propertyOfficialValuationHydrationJobs = pgTable(
  'property_official_valuation_hydration_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 50 }).notNull(),
    valuationYear: integer('valuation_year').notNull(),
    state: varchar('state', { length: 30 }).notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_official_valuation_hydration_unique_idx').on(
      table.propertyId,
      table.source,
      table.valuationYear
    ),
    index('property_official_valuation_hydration_due_idx').on(
      table.state,
      table.nextAttemptAt
    ),
  ]
);

export const officialValuationSourceStates = pgTable(
  'official_valuation_source_states',
  {
    source: varchar('source', { length: 50 }).primaryKey(),
    state: varchar('state', { length: 30 }).notNull().default('healthy'),
    requestsInCurrentMinute: integer('requests_in_current_minute').notNull().default(0),
    minuteWindowResetAt: timestamp('minute_window_reset_at', { withTimezone: true }),
    requestsInCurrentDay: integer('requests_in_current_day').notNull().default(0),
    dayWindowResetAt: timestamp('day_window_reset_at', { withTimezone: true }),
    requestsInFlight: integer('requests_in_flight').notNull().default(0),
    requestsInFlightLeaseExpiresAt: timestamp('requests_in_flight_lease_expires_at', {
      withTimezone: true,
    }),
    circuitOpenedAt: timestamp('circuit_opened_at', { withTimezone: true }),
    circuitHalfOpenAt: timestamp('circuit_half_open_at', { withTimezone: true }),
    consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastRateLimitAt: timestamp('last_rate_limit_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// Durable ingest run ledger (optional when upstream provides a stable run identity)
export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    upstreamRunKey: varchar('upstream_run_key', { length: 255 }).notNull(),
    upstreamCursorStart: text('upstream_cursor_start'),
    upstreamCursorEnd: text('upstream_cursor_end'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: ingestRunStatusEnum('status').notNull().default('in_progress'),
    processedBatchCount: integer('processed_batch_count').notNull().default(0),
    errorSummary: jsonb('error_summary').$type<Record<string, unknown> | null>(),
  },
  (table) => [
    uniqueIndex('ingest_runs_source_upstream_key_idx').on(table.sourceName, table.upstreamRunKey),
    index('ingest_runs_source_started_idx').on(table.sourceName, table.startedAt),
    index('ingest_runs_status_idx').on(table.status),
  ]
);

// Durable ingest batch ledger + durable maintenance refresh state
export const ingestBatches = pgTable(
  'ingest_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => ingestRuns.id, { onDelete: 'set null' }),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    batchSequence: integer('batch_sequence').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    cursorStart: text('cursor_start'),
    cursorEnd: text('cursor_end').notNull(),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    status: ingestBatchStatusEnum('status').notNull().default('accepted'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ingestedCount: integer('ingested_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    errorJson: jsonb('error_json').$type<Record<string, unknown> | null>(),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    maintenanceRequestedAt: timestamp('maintenance_requested_at', { withTimezone: true }),
    maintenanceCompletedAt: timestamp('maintenance_completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ingest_batches_source_idempotency_idx').on(table.sourceName, table.idempotencyKey),
    uniqueIndex('ingest_batches_run_sequence_idx').on(table.runId, table.batchSequence).where(sql`run_id IS NOT NULL`),
    index('ingest_batches_source_status_received_idx').on(table.sourceName, table.status, table.receivedAt),
    index('ingest_batches_source_cursor_status_idx').on(table.sourceName, table.cursorStart, table.status),
    index('ingest_batches_completed_idx').on(table.completedAt),
    index('ingest_batches_maintenance_pending_idx')
      .on(table.maintenanceRequestedAt, table.maintenanceCompletedAt)
      .where(sql`maintenance_requested_at IS NOT NULL AND maintenance_completed_at IS NULL`),
  ]
);

// Authoritative checkpoint per source
export const ingestSources = pgTable(
  'ingest_sources',
  {
    sourceName: varchar('source_name', { length: 50 }).primaryKey(),
    lastCommittedCursor: text('last_committed_cursor'),
    lastCommittedChangedAt: timestamp('last_committed_changed_at', { withTimezone: true }),
    lastCommittedListingKey: text('last_committed_listing_key'),
    lastBatchId: uuid('last_batch_id').references(() => ingestBatches.id, { onDelete: 'set null' }),
    lastRunStartedAt: timestamp('last_run_started_at', { withTimezone: true }),
    lastRunCompletedAt: timestamp('last_run_completed_at', { withTimezone: true }),
    lastRunStatus: ingestRunStatusEnum('last_run_status'),
  },
  (table) => [
    index('ingest_sources_last_batch_idx').on(table.lastBatchId),
  ]
);

export const listingSourceAliases = pgTable(
  'listing_source_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    aliasKind: listingSourceAliasKindEnum('alias_kind').notNull(),
    aliasValue: text('alias_value').notNull(),
    primarySourceListingId: varchar('primary_source_listing_id', { length: 255 }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_source_aliases_source_alias_idx').on(table.sourceName, table.aliasKind, table.aliasValue),
    uniqueIndex('listing_source_aliases_source_primary_alias_idx').on(
      table.sourceName,
      table.primarySourceListingId,
      table.aliasKind,
      table.aliasValue
    ),
    index('listing_source_aliases_primary_idx').on(table.sourceName, table.primarySourceListingId),
  ]
);

export const canonicalListings = pgTable(
  'canonical_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    primarySourceListingId: varchar('primary_source_listing_id', { length: 255 }),
    canonicalUrl: text('canonical_url'),
    displayUrl: text('display_url'),
    status: canonicalListingStatusEnum('status').notNull().default('active'),
    statusSource: canonicalListingStatusSourceEnum('status_source').notNull().default('system'),
    verificationState: canonicalListingVerificationStateEnum('verification_state').notNull().default('provisional'),
    originSummary: canonicalListingOriginSummaryEnum('origin_summary').notNull().default('user'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    thumbnailUrl: text('thumbnail_url'),
    title: text('title'),
    description: text('description'),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    priceCurrency: varchar('price_currency', { length: 3 }),
    priceType: varchar('price_type', { length: 10 }),
    livingAreaM2: integer('living_area_m2'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastMirrorSeenAt: timestamp('last_mirror_seen_at', { withTimezone: true }),
    lastUserSeenAt: timestamp('last_user_seen_at', { withTimezone: true }),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('canonical_listings_source_identity_idx')
      .on(table.sourceName, table.primarySourceListingId)
      .where(sql`primary_source_listing_id IS NOT NULL`),
    uniqueIndex('canonical_listings_source_url_idx')
      .on(table.sourceName, table.canonicalUrl)
      .where(sql`canonical_url IS NOT NULL`),
    index('canonical_listings_property_id_idx').on(table.propertyId),
    index('canonical_listings_property_status_idx').on(table.propertyId, table.status),
    index('canonical_listings_verification_state_idx').on(table.verificationState),
    index('canonical_listings_tile_latest_idx')
      .on(
        table.propertyId,
        sql`COALESCE(last_reconciled_at, last_mirror_seen_at, last_user_seen_at, last_seen_at, updated_at, created_at) DESC`,
        sql`created_at DESC`,
        sql`id DESC`
      )
      .where(sql`verification_state <> 'invalid'`),
    index('canonical_listings_tile_active_latest_idx')
      .on(
        table.propertyId,
        sql`COALESCE(last_reconciled_at, last_mirror_seen_at, last_user_seen_at, last_seen_at, updated_at, created_at) DESC`,
        sql`created_at DESC`,
        sql`id DESC`
      )
      .where(sql`verification_state <> 'invalid' AND status = 'active'`),
    index('canonical_listings_tile_candidate_status_property_idx')
      .on(table.status, table.propertyId)
      .where(sql`verification_state <> 'invalid' AND status IN ('active', 'sold', 'rented')`),
    index('canonical_listings_tile_thumbnail_idx')
      .on(
        table.propertyId,
        sql`(status = 'active') DESC`,
        sql`COALESCE(last_reconciled_at, last_mirror_seen_at, last_user_seen_at, last_seen_at, updated_at, created_at) DESC`,
        sql`created_at DESC`,
        sql`id DESC`
      )
      .where(sql`verification_state <> 'invalid' AND thumbnail_url IS NOT NULL`),
  ]
);

export const propertyTileListingCandidates = pgTable(
  'property_tile_listing_candidates',
  {
    propertyId: uuid('property_id')
      .primaryKey()
      .references(() => properties.id, { onDelete: 'cascade' }),
    geometry: geometry('geometry').notNull(),
    officialValuation: bigint('official_valuation', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_tile_listing_candidates_geometry_gist_idx').using('gist', table.geometry),
  ]
);

export const mirrorListingWatches = pgTable(
  'mirror_listing_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    sourceUrlRaw: text('source_url_raw').notNull(),
    sourceUrlCanonical: text('source_url_canonical').notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    canonicalListingId: uuid('canonical_listing_id').references(() => canonicalListings.id, { onDelete: 'set null' }),
    state: mirrorListingWatchStateEnum('state').notNull().default('pending'),
    stateReason: varchar('state_reason', { length: 100 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastValidationObservationId: uuid('last_validation_observation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mirror_listing_watches_active_url_idx')
      .on(table.sourceName, table.propertyId, table.sourceUrlCanonical)
      .where(sql`state IN ('pending', 'queued', 'fetching', 'retryable_error')`),
    index('mirror_listing_watches_state_next_attempt_idx').on(table.state, table.nextAttemptAt),
    index('mirror_listing_watches_canonical_listing_idx').on(table.canonicalListingId),
  ]
);

export const listingObservations = pgTable(
  'listing_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    sourceListingIdKind: listingSourceIdKindEnum('source_listing_id_kind'),
    sourceListingAliases: jsonb('source_listing_aliases')
      .$type<Array<{ kind: string; value: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceUrlRaw: text('source_url_raw'),
    sourceUrlCanonical: text('source_url_canonical'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    origin: listingObservationOriginEnum('origin').notNull(),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    propertyMatchKind: listingPropertyMatchKindEnum('property_match_kind').notNull().default('source_unmatched'),
    sourceStatus: listingSourceStatusEnum('source_status').notNull().default('unknown'),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    priceCurrency: varchar('price_currency', { length: 3 }),
    addressRaw: text('address_raw'),
    addressNormalized: jsonb('address_normalized').$type<Record<string, unknown> | null>(),
    postalCode: varchar('postal_code', { length: 20 }),
    houseNumber: integer('house_number'),
    houseNumberAddition: varchar('house_number_addition', { length: 50 }),
    listedAt: timestamp('listed_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    ingestBatchId: uuid('ingest_batch_id').references(() => ingestBatches.id, { onDelete: 'set null' }),
    validationWatchId: uuid('validation_watch_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_observations_mirror_idempotency_idx')
      .on(table.sourceName, table.sourceListingId, table.origin, table.observedAt)
      .where(sql`source_listing_id IS NOT NULL`),
    index('listing_observations_source_identity_idx').on(table.sourceName, table.sourceListingId),
    index('listing_observations_source_url_idx').on(table.sourceName, table.sourceUrlCanonical),
    index('listing_observations_property_id_idx').on(table.propertyId),
    index('listing_observations_ingest_batch_idx').on(table.ingestBatchId),
    index('listing_observations_validation_watch_idx').on(table.validationWatchId),
  ]
);

export const listingObservationLinks = pgTable(
  'listing_observation_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalListingId: uuid('canonical_listing_id')
      .notNull()
      .references(() => canonicalListings.id, { onDelete: 'cascade' }),
    listingObservationId: uuid('listing_observation_id')
      .notNull()
      .references(() => listingObservations.id, { onDelete: 'cascade' }),
    linkReason: listingObservationLinkReasonEnum('link_reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_observation_links_observation_idx').on(table.listingObservationId),
    index('listing_observation_links_canonical_idx').on(table.canonicalListingId),
  ]
);

export const listingPriceObservations = pgTable(
  'listing_price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingObservationId: uuid('listing_observation_id')
      .notNull()
      .references(() => listingObservations.id, { onDelete: 'cascade' }),
    canonicalListingId: uuid('canonical_listing_id')
      .notNull()
      .references(() => canonicalListings.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    origin: listingObservationOriginEnum('origin').notNull(),
    price: bigint('price', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    eventType: listingPriceObservationEventTypeEnum('event_type').notNull(),
    priceDate: date('price_date', { mode: 'string' }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_price_observations_source_dedup_idx')
      .on(table.canonicalListingId, table.sourceName, table.sourceListingId, table.priceDate, table.price, table.eventType)
      .where(sql`source_listing_id IS NOT NULL`),
    index('listing_price_observations_property_idx').on(table.propertyId),
    index('listing_price_observations_observation_idx').on(table.listingObservationId),
  ]
);

export const listingReplayStaging = pgTable(
  'listing_replay_staging',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    upstreamRunKey: varchar('upstream_run_key', { length: 255 }).notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    sourceListingIdKind: listingSourceIdKindEnum('source_listing_id_kind'),
    sourceListingAliases: jsonb('source_listing_aliases')
      .$type<Array<{ kind: string; value: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceUrlRaw: text('source_url_raw'),
    sourceUrlCanonical: text('source_url_canonical'),
    sourceStatus: listingSourceStatusEnum('source_status').notNull().default('unknown'),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    propertyMatchKind: listingPropertyMatchKindEnum('property_match_kind').notNull().default('source_unmatched'),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    priceCurrency: varchar('price_currency', { length: 3 }),
    addressNormalized: jsonb('address_normalized').$type<Record<string, unknown> | null>(),
    listedAt: timestamp('listed_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('listing_replay_staging_run_idx').on(table.sourceName, table.upstreamRunKey),
    index('listing_replay_staging_source_identity_idx').on(table.sourceName, table.sourceListingId),
    index('listing_replay_staging_processed_idx').on(table.processedAt),
  ]
);

// Price Guesses table
export const priceGuesses = pgTable(
  'price_guesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guessedPrice: bigint('guessed_price', { mode: 'number' }).notNull(),
    isMemeGuess: boolean('is_meme_guess').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('price_guesses_property_id_idx').on(table.propertyId),
    index('price_guesses_user_id_idx').on(table.userId),
    // Unique constraint: one guess per user per property (updates allowed with cooldown)
    uniqueIndex('price_guesses_user_property_idx').on(table.userId, table.propertyId),
    index('idx_price_guesses_property_created').on(table.propertyId, sql`created_at DESC`),
    index('price_guesses_property_user_effective_at_idx').on(
      table.propertyId,
      table.userId,
      sql`GREATEST(created_at, updated_at) DESC`,
      sql`created_at DESC`,
      sql`id DESC`
    ),
  ]
);

// Comments table
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'), // Self-referencing for replies (1-level deep)
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comments_property_id_idx').on(table.propertyId),
    index('comments_user_id_idx').on(table.userId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_created_at_idx').on(table.createdAt),
    index('idx_comments_property_created').on(table.propertyId, sql`created_at DESC`),
    index('comments_top_level_property_created_idx')
      .on(table.propertyId, sql`created_at DESC`)
      .where(sql`parent_id IS NULL`),
    index('comments_replies_property_created_idx')
      .on(table.propertyId, sql`created_at DESC`)
      .where(sql`parent_id IS NOT NULL`),
  ]
);

// Reactions table (likes on properties or comments)
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: targetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reactionType: reactionTypeEnum('reaction_type').notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reactions_target_idx').on(table.targetType, table.targetId),
    index('reactions_user_id_idx').on(table.userId),
    // Unique constraint: one reaction per user per target
    uniqueIndex('reactions_user_target_idx').on(table.userId, table.targetType, table.targetId),
    index('idx_reactions_property_like').on(table.targetId, sql`created_at DESC`).where(sql`target_type = 'property' AND reaction_type = 'like'`),
    index('reactions_comment_like_target_created_idx')
      .on(table.targetId, sql`created_at DESC`)
      .where(sql`target_type = 'comment' AND reaction_type = 'like'`),
  ]
);

// Property Views table (for tracking interest signals)
export const propertyViews = pgTable(
  'property_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // null for anonymous
    sessionId: text('session_id'), // for anonymous dedup
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_views_property_user_idx').on(table.propertyId, table.userId),
    index('property_views_property_session_idx').on(table.propertyId, table.sessionId),
    index('property_views_property_viewed_at_idx').on(table.propertyId, table.viewedAt),
    index('property_views_property_identity_viewed_at_idx').on(
      table.propertyId,
      sql`COALESCE(user_id::text, session_id)`,
      sql`viewed_at DESC`
    ),
    check(
      'property_views_identity_required_chk',
      sql`${table.userId} IS NOT NULL OR ${table.sessionId} IS NOT NULL`,
    ),
  ]
);

export const propertyTileSnapshots = pgTable(
  'property_tile_snapshots',
  {
    z: integer('z').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    filterSignature: text('filter_signature').notNull(),
    coverageId: text('coverage_id').notNull(),
    payload: bytea('payload'),
    statusCode: integer('status_code').notNull(),
    etag: text('etag').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    sourceListingWatermark: bigint('source_listing_watermark', { mode: 'bigint' }).notNull(),
    sourceSocialWatermark: bigint('source_social_watermark', { mode: 'bigint' }).notNull(),
    sourcePropertyWatermark: bigint('source_property_watermark', { mode: 'bigint' }).notNull(),
    sourceCoverageWatermark: bigint('source_coverage_watermark', { mode: 'bigint' }).notNull(),
    snapshotConfigHash: text('snapshot_config_hash').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.z, table.x, table.y, table.filterSignature] }),
    check(
      'property_tile_snapshots_status_code_check',
      sql`${table.statusCode} IN (200, 204)`,
    ),
    check(
      'property_tile_snapshots_payload_check',
      sql`(
        (${table.statusCode} = 200 AND ${table.payload} IS NOT NULL AND octet_length(${table.payload}) > 0)
        OR (${table.statusCode} = 204 AND ${table.payload} IS NULL)
      )`,
    ),
    index('property_tile_snapshots_generated_at_idx').on(table.generatedAt),
    index('property_tile_snapshots_coverage_idx').on(table.coverageId, table.snapshotConfigHash),
    index('property_tile_snapshots_coverage_filter_config_idx').on(
      table.coverageId,
      table.filterSignature,
      table.snapshotConfigHash
    ),
    index('property_tile_snapshots_coverage_filter_config_due_idx').on(
      table.coverageId,
      table.filterSignature,
      table.snapshotConfigHash
    ),
  ],
);

export const propertyTileSnapshotCoverage = pgTable(
  'property_tile_snapshot_coverage',
  {
    coverageId: text('coverage_id').primaryKey(),
    boundsSource: text('bounds_source').notNull(),
    minLon: doublePrecision('min_lon').notNull(),
    minLat: doublePrecision('min_lat').notNull(),
    maxLon: doublePrecision('max_lon').notNull(),
    maxLat: doublePrecision('max_lat').notNull(),
    countries: text('countries').array().notNull(),
    dataSources: text('data_sources').array().notNull(),
    maxZoom: integer('max_zoom').notNull(),
    filterSignature: text('filter_signature').notNull(),
    coverageWatermark: bigint('coverage_watermark', { mode: 'bigint' }).notNull().default(0n),
    snapshotConfigHash: text('snapshot_config_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'property_tile_snapshot_coverage_bounds_check',
      sql`${table.minLon} < ${table.maxLon} AND ${table.minLat} < ${table.maxLat}`,
    ),
    check(
      'property_tile_snapshot_coverage_zoom_check',
      sql`${table.maxZoom} >= 0 AND ${table.maxZoom} <= 22`,
    ),
  ],
);

export const propertyTileSnapshotWatermarks = pgTable('property_tile_snapshot_watermarks', {
  key: text('key').primaryKey(),
  listingWatermark: bigint('listing_watermark', { mode: 'bigint' }).notNull().default(0n),
  socialWatermark: bigint('social_watermark', { mode: 'bigint' }).notNull().default(0n),
  propertyWatermark: bigint('property_watermark', { mode: 'bigint' }).notNull().default(0n),
  coverageWatermark: bigint('coverage_watermark', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const propertyTileSnapshotRefreshState = pgTable('property_tile_snapshot_refresh_state', {
  key: text('key').primaryKey(),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  requestReason: text('request_reason'),
  requestedListingWatermark: bigint('requested_listing_watermark', { mode: 'bigint' }).notNull().default(0n),
  requestedSocialWatermark: bigint('requested_social_watermark', { mode: 'bigint' }).notNull().default(0n),
  requestedPropertyWatermark: bigint('requested_property_watermark', { mode: 'bigint' }).notNull().default(0n),
  requestedCoverageWatermark: bigint('requested_coverage_watermark', { mode: 'bigint' }).notNull().default(0n),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastFinishedAt: timestamp('last_finished_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  appliedListingWatermark: bigint('applied_listing_watermark', { mode: 'bigint' }).notNull().default(0n),
  appliedSocialWatermark: bigint('applied_social_watermark', { mode: 'bigint' }).notNull().default(0n),
  appliedPropertyWatermark: bigint('applied_property_watermark', { mode: 'bigint' }).notNull().default(0n),
  appliedCoverageWatermark: bigint('applied_coverage_watermark', { mode: 'bigint' }).notNull().default(0n),
  coverageId: text('coverage_id'),
  snapshotConfigHash: text('snapshot_config_hash'),
  expectedTileCount: integer('expected_tile_count'),
  refreshedTileCount: integer('refreshed_tile_count').notNull().default(0),
  failedTileCount: integer('failed_tile_count').notNull().default(0),
  lastWindowRefreshAt: timestamp('last_window_refresh_at', { withTimezone: true }),
});

// Canonical per-property user-visible change marker.
// Kept separate from properties so imports do not rewrite the wide address table.
export const propertyChangeState = pgTable(
  'property_change_state',
  {
    propertyId: uuid('property_id')
      .primaryKey()
      .references(() => properties.id, { onDelete: 'cascade' }),
    changeVersion: bigint('change_version', { mode: 'number' }).notNull().default(0),
    lastChangedAt: timestamp('last_changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_change_state_last_changed_at_idx').on(table.lastChangedAt),
  ]
);

// Per-viewer read state for authenticated users and anonymous sessions.
export const propertyReadState = pgTable(
  'property_read_state',
  {
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    seenChangeVersion: bigint('seen_change_version', { mode: 'number' }).notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_read_state_user_property_idx')
      .on(table.userId, table.propertyId)
      .where(sql`user_id IS NOT NULL AND session_id IS NULL`),
    uniqueIndex('property_read_state_session_property_idx')
      .on(table.sessionId, table.propertyId)
      .where(sql`session_id IS NOT NULL AND user_id IS NULL`),
    index('property_read_state_anonymous_seen_at_idx')
      .on(table.seenAt)
      .where(sql`session_id IS NOT NULL AND user_id IS NULL`),
    check(
      'property_read_state_exactly_one_identity_chk',
      sql`(${table.userId} IS NULL) <> (${table.sessionId} IS NULL)`,
    ),
    check(
      'property_read_state_session_not_blank_chk',
      sql`${table.sessionId} IS NULL OR BTRIM(${table.sessionId}) <> ''`,
    ),
  ]
);

// Saved Properties table
export const savedProperties = pgTable(
  'saved_properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saved_properties_user_id_idx').on(table.userId),
    uniqueIndex('saved_properties_user_property_idx').on(table.userId, table.propertyId),
  ]
);

// One-way follow graph
export const userFollows = pgTable(
  'user_follows',
  {
    followerUserId: uuid('follower_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followedUserId: uuid('followed_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerUserId, table.followedUserId] }),
    index('user_follows_follower_created_idx').on(
      table.followerUserId,
      sql`created_at DESC`,
      table.followedUserId,
    ),
    index('user_follows_followed_created_idx').on(
      table.followedUserId,
      sql`created_at DESC`,
      table.followerUserId,
    ),
    check(
      'user_follows_not_self_chk',
      sql`${table.followerUserId} <> ${table.followedUserId}`,
    ),
  ],
);

// Notification event types
export const notificationEventTypeEnum = pgEnum('notification_event_type', [
  'property_comment',       // Someone commented on a property you interacted with
  'comment_reply',          // Someone replied to your comment
  'comment_like',           // Someone liked your comment
  'property_like',          // Someone liked a property you own/listed
  'property_guess',         // Someone guessed on a property you interacted with
  'new_follower',           // Someone followed you
  'achievement_unlocked',   // You unlocked an achievement
]);

// Notifications table
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    eventType: notificationEventTypeEnum('event_type').notNull(),
    propertyId: uuid('property_id')
      .references(() => properties.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id'),
    guessId: uuid('guess_id'),
    reactionId: uuid('reaction_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    index('notifications_recipient_unread_idx')
      .on(table.recipientUserId, table.createdAt)
      .where(sql`read_at IS NULL`),
  ]
);

// Push Tokens table (device-scoped)
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    platform: varchar('platform', { length: 20 }).notNull(), // 'ios' | 'android' | 'web'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('push_tokens_user_id_idx').on(table.userId),
    uniqueIndex('push_tokens_device_idx').on(table.userId, table.deviceId),
  ]
);

// User Achievements table
export const userAchievements = pgTable(
  'user_achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementKey: varchar('achievement_key', { length: 100 }).notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    sourceEventType: varchar('source_event_type', { length: 50 }),
    sourceEventId: uuid('source_event_id'),
  },
  (table) => [
    uniqueIndex('user_achievements_unique_idx').on(table.userId, table.achievementKey),
    index('user_achievements_user_id_idx').on(table.userId),
  ]
);

// Email Auth Tokens table (magic link verification)
export const emailAuthTokens = pgTable(
  'email_auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('email_auth_tokens_email_idx').on(table.email),
    index('email_auth_tokens_token_idx').on(table.token),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  priceGuesses: many(priceGuesses),
  comments: many(comments),
  reactions: many(reactions),
  savedProperties: many(savedProperties),
  listings: many(listings),
  canonicalListings: many(canonicalListings),
  listingObservations: many(listingObservations),
  mirrorListingWatches: many(mirrorListingWatches),
  propertyViews: many(propertyViews),
  notifications: many(notifications, { relationName: 'recipientNotifications' }),
  pushTokens: many(pushTokens),
  achievements: many(userAchievements),
  followers: many(userFollows, { relationName: 'followedUser' }),
  following: many(userFollows, { relationName: 'followerUser' }),
  submittedOfficialValuations: many(propertyOfficialValuations),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  listings: many(listings),
  canonicalListings: many(canonicalListings),
  listingObservations: many(listingObservations),
  mirrorListingWatches: many(mirrorListingWatches),
  listingPriceObservations: many(listingPriceObservations),
  priceGuesses: many(priceGuesses),
  comments: many(comments),
  savedProperties: many(savedProperties),
  priceHistory: many(priceHistory),
  propertyViews: many(propertyViews),
  officialValuations: many(propertyOfficialValuations),
  officialValuationHydrationJobs: many(propertyOfficialValuationHydrationJobs),
}));

export const listingsRelations = relations(listings, ({ one }) => ({
  property: one(properties, {
    fields: [listings.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [listings.submittedBy],
    references: [users.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  property: one(properties, {
    fields: [priceHistory.propertyId],
    references: [properties.id],
  }),
  listing: one(listings, {
    fields: [priceHistory.listingId],
    references: [listings.id],
  }),
}));

export const propertyOfficialValuationsRelations = relations(propertyOfficialValuations, ({ one }) => ({
  property: one(properties, {
    fields: [propertyOfficialValuations.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [propertyOfficialValuations.submittedByUserId],
    references: [users.id],
  }),
}));

export const propertyOfficialValuationHydrationJobsRelations = relations(
  propertyOfficialValuationHydrationJobs,
  ({ one }) => ({
    property: one(properties, {
      fields: [propertyOfficialValuationHydrationJobs.propertyId],
      references: [properties.id],
    }),
  })
);

export const listingSourceAliasesRelations = relations(listingSourceAliases, () => ({}));

export const canonicalListingsRelations = relations(canonicalListings, ({ one, many }) => ({
  property: one(properties, {
    fields: [canonicalListings.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [canonicalListings.submittedBy],
    references: [users.id],
  }),
  observationLinks: many(listingObservationLinks),
  priceObservations: many(listingPriceObservations),
  mirrorWatches: many(mirrorListingWatches),
}));

export const mirrorListingWatchesRelations = relations(mirrorListingWatches, ({ one }) => ({
  property: one(properties, {
    fields: [mirrorListingWatches.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [mirrorListingWatches.submittedBy],
    references: [users.id],
  }),
  canonicalListing: one(canonicalListings, {
    fields: [mirrorListingWatches.canonicalListingId],
    references: [canonicalListings.id],
  }),
}));

export const listingObservationsRelations = relations(listingObservations, ({ one, many }) => ({
  property: one(properties, {
    fields: [listingObservations.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [listingObservations.submittedBy],
    references: [users.id],
  }),
  ingestBatch: one(ingestBatches, {
    fields: [listingObservations.ingestBatchId],
    references: [ingestBatches.id],
  }),
  observationLink: one(listingObservationLinks),
  priceObservations: many(listingPriceObservations),
}));

export const listingObservationLinksRelations = relations(listingObservationLinks, ({ one }) => ({
  canonicalListing: one(canonicalListings, {
    fields: [listingObservationLinks.canonicalListingId],
    references: [canonicalListings.id],
  }),
  listingObservation: one(listingObservations, {
    fields: [listingObservationLinks.listingObservationId],
    references: [listingObservations.id],
  }),
}));

export const listingPriceObservationsRelations = relations(listingPriceObservations, ({ one }) => ({
  listingObservation: one(listingObservations, {
    fields: [listingPriceObservations.listingObservationId],
    references: [listingObservations.id],
  }),
  canonicalListing: one(canonicalListings, {
    fields: [listingPriceObservations.canonicalListingId],
    references: [canonicalListings.id],
  }),
  property: one(properties, {
    fields: [listingPriceObservations.propertyId],
    references: [properties.id],
  }),
}));

export const listingReplayStagingRelations = relations(listingReplayStaging, ({ one }) => ({
  property: one(properties, {
    fields: [listingReplayStaging.propertyId],
    references: [properties.id],
  }),
}));

export const ingestRunsRelations = relations(ingestRuns, ({ many }) => ({
  batches: many(ingestBatches),
}));

export const ingestBatchesRelations = relations(ingestBatches, ({ one, many }) => ({
  run: one(ingestRuns, {
    fields: [ingestBatches.runId],
    references: [ingestRuns.id],
  }),
  listingObservations: many(listingObservations),
}));

export const ingestSourcesRelations = relations(ingestSources, ({ one }) => ({
  lastBatch: one(ingestBatches, {
    fields: [ingestSources.lastBatchId],
    references: [ingestBatches.id],
  }),
}));

export const priceGuessesRelations = relations(priceGuesses, ({ one }) => ({
  property: one(properties, {
    fields: [priceGuesses.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [priceGuesses.userId],
    references: [users.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  property: one(properties, {
    fields: [comments.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'parentChild',
  }),
  replies: many(comments, {
    relationName: 'parentChild',
  }),
}));

export const reactionsRelations = relations(reactions, ({ one }) => ({
  user: one(users, {
    fields: [reactions.userId],
    references: [users.id],
  }),
}));

export const savedPropertiesRelations = relations(savedProperties, ({ one }) => ({
  property: one(properties, {
    fields: [savedProperties.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [savedProperties.userId],
    references: [users.id],
  }),
}));

export const propertyViewsRelations = relations(propertyViews, ({ one }) => ({
  property: one(properties, {
    fields: [propertyViews.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [propertyViews.userId],
    references: [users.id],
  }),
}));

// Export types for use in the application
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

export type ListingSourceAlias = typeof listingSourceAliases.$inferSelect;
export type NewListingSourceAlias = typeof listingSourceAliases.$inferInsert;

export type CanonicalListing = typeof canonicalListings.$inferSelect;
export type NewCanonicalListing = typeof canonicalListings.$inferInsert;

export type MirrorListingWatch = typeof mirrorListingWatches.$inferSelect;
export type NewMirrorListingWatch = typeof mirrorListingWatches.$inferInsert;

export type ListingObservation = typeof listingObservations.$inferSelect;
export type NewListingObservation = typeof listingObservations.$inferInsert;

export type ListingObservationLink = typeof listingObservationLinks.$inferSelect;
export type NewListingObservationLink = typeof listingObservationLinks.$inferInsert;

export type ListingPriceObservation = typeof listingPriceObservations.$inferSelect;
export type NewListingPriceObservation = typeof listingPriceObservations.$inferInsert;

export type ListingReplayStaging = typeof listingReplayStaging.$inferSelect;
export type NewListingReplayStaging = typeof listingReplayStaging.$inferInsert;

export type PriceGuess = typeof priceGuesses.$inferSelect;
export type NewPriceGuess = typeof priceGuesses.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;

export type SavedProperty = typeof savedProperties.$inferSelect;
export type NewSavedProperty = typeof savedProperties.$inferInsert;

export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;

export type PriceHistory = typeof priceHistory.$inferSelect;
export type NewPriceHistory = typeof priceHistory.$inferInsert;

export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;

export type IngestBatch = typeof ingestBatches.$inferSelect;
export type NewIngestBatch = typeof ingestBatches.$inferInsert;

export type IngestSource = typeof ingestSources.$inferSelect;
export type NewIngestSource = typeof ingestSources.$inferInsert;

export type PropertyOfficialValuation = typeof propertyOfficialValuations.$inferSelect;
export type NewPropertyOfficialValuation = typeof propertyOfficialValuations.$inferInsert;

export type PropertyOfficialValuationHydrationJob =
  typeof propertyOfficialValuationHydrationJobs.$inferSelect;
export type NewPropertyOfficialValuationHydrationJob =
  typeof propertyOfficialValuationHydrationJobs.$inferInsert;

export type OfficialValuationSourceState = typeof officialValuationSourceStates.$inferSelect;
export type NewOfficialValuationSourceState = typeof officialValuationSourceStates.$inferInsert;

export type PropertyView = typeof propertyViews.$inferSelect;
export type NewPropertyView = typeof propertyViews.$inferInsert;

export type PropertyTileSnapshot = typeof propertyTileSnapshots.$inferSelect;
export type NewPropertyTileSnapshot = typeof propertyTileSnapshots.$inferInsert;

export type PropertyTileSnapshotCoverage = typeof propertyTileSnapshotCoverage.$inferSelect;
export type NewPropertyTileSnapshotCoverage = typeof propertyTileSnapshotCoverage.$inferInsert;

export type PropertyTileSnapshotWatermark = typeof propertyTileSnapshotWatermarks.$inferSelect;
export type NewPropertyTileSnapshotWatermark = typeof propertyTileSnapshotWatermarks.$inferInsert;

export type PropertyTileSnapshotRefreshState = typeof propertyTileSnapshotRefreshState.$inferSelect;
export type NewPropertyTileSnapshotRefreshState = typeof propertyTileSnapshotRefreshState.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;

export type UserAchievement = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;

export type EmailAuthToken = typeof emailAuthTokens.$inferSelect;
export type NewEmailAuthToken = typeof emailAuthTokens.$inferInsert;

// Notification relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.recipientUserId],
    references: [users.id],
    relationName: 'recipientNotifications',
  }),
  actor: one(users, {
    fields: [notifications.actorUserId],
    references: [users.id],
  }),
  property: one(properties, {
    fields: [notifications.propertyId],
    references: [properties.id],
  }),
}));

export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  followerUser: one(users, {
    fields: [userFollows.followerUserId],
    references: [users.id],
    relationName: 'followerUser',
  }),
  followedUser: one(users, {
    fields: [userFollows.followedUserId],
    references: [users.id],
    relationName: 'followedUser',
  }),
}));

// Push token relations
export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

// User achievement relations
export const userAchievementsRelations = relations(userAchievements, ({ one }) => ({
  user: one(users, {
    fields: [userAchievements.userId],
    references: [users.id],
  }),
}));
