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
  foreignKey,
  type AnyPgColumn,
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
]);
export const listingDiagnosticStatusEnum = pgEnum('listing_diagnostic_status', [
  'blocked',
  'parser_error',
  'retryable_error',
  'unsupported',
  'invalid',
  'unknown',
  'mirror_unavailable',
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
export const listingCandidateHandoffStateEnum = pgEnum('listing_candidate_handoff_state', [
  'pending',
  'queued',
  'delivered',
  'retryable_error',
  'dead_letter',
]);
export const propertyTilePyramidKindEnum = pgEnum('property_tile_pyramid_kind', [
  'public_default_low_zoom',
]);
export const propertyTilePyramidVersionStatusEnum = pgEnum('property_tile_pyramid_version_status', [
  'queued',
  'building',
  'validating',
  'validated',
  'promoted',
  'failed_retryable',
  'failed_terminal',
  'superseded',
]);
export const propertyTilePyramidTileStatusEnum = pgEnum('property_tile_pyramid_tile_status', [
  'pending',
  'valid_empty',
  'valid_nodes',
  'valid_encoded',
  'failed',
]);
export const propertyTilePyramidTileValidationStatusEnum = pgEnum(
  'property_tile_pyramid_tile_validation_status',
  ['pending', 'validated', 'failed'],
);
export const propertyTilePyramidNodeClassEnum = pgEnum('property_tile_pyramid_node_class', [
  'active',
  'ghost',
]);
export const propertyTilePyramidGroupKindEnum = pgEnum('property_tile_pyramid_group_kind', [
  'single',
  'cluster',
]);
export const propertyTilePyramidWatermarkScopeEnum = pgEnum(
  'property_tile_pyramid_watermark_scope',
  [
    'snapshot_watermarks',
    'ingest_source',
    'listing_source_scope',
    'listing_scope_completion',
    'listing_candidates',
    'listing_facts',
    'property_geometry',
    'property_status',
    'social_inputs',
    'official_valuations',
    'views_engagement',
    'rolling_social_window',
    'coverage',
  ],
);
export const propertyTilePyramidAuditActionEnum = pgEnum('property_tile_pyramid_audit_action', [
  'created',
  'status_changed',
  'promoted',
  'rollback',
  'degraded',
  'validation_failed',
  'retention_deleted',
  'lease_acquired',
  'lease_released',
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

export const listingScopeCompletions = pgTable(
  'listing_scope_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    scopeKey: varchar('scope_key', { length: 255 }).notNull(),
    listingType: varchar('listing_type', { length: 20 }).notNull().default('unknown'),
    normalizedFilters: jsonb('normalized_filters').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    sourceRunId: varchar('source_run_id', { length: 255 }),
    sourceRunStartedAt: timestamp('source_run_started_at', { withTimezone: true }),
    sourceRunCompletedAt: timestamp('source_run_completed_at', { withTimezone: true }).notNull(),
    coverageStatus: varchar('coverage_status', { length: 30 }).notNull().default('complete'),
    observedListingCount: integer('observed_listing_count').notNull().default(0),
    sourceHighWatermark: timestamp('source_high_watermark', { withTimezone: true }).notNull(),
    staleForProjection: boolean('stale_for_projection').notNull().default(false),
    repairMode: boolean('repair_mode').notNull().default(false),
    repairReason: text('repair_reason'),
    ingestBatchId: uuid('ingest_batch_id').references(() => ingestBatches.id, { onDelete: 'set null' }),
    diagnostics: jsonb('diagnostics').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_scope_completions_idempotency_idx').on(
      table.sourceName,
      table.scopeKey,
      table.listingType,
      table.normalizedFilters,
      sql`COALESCE(${table.sourceRunId}, '')`,
      table.sourceHighWatermark
    ),
    index('listing_scope_completions_source_scope_idx').on(table.sourceName, table.scopeKey, table.listingType),
    index('listing_scope_completions_batch_idx').on(table.ingestBatchId),
  ]
);

export const listingSourceScopeWatermarks = pgTable(
  'listing_source_scope_watermarks',
  {
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    scopeKey: varchar('scope_key', { length: 255 }).notNull(),
    listingType: varchar('listing_type', { length: 20 }).notNull().default('unknown'),
    sourceHighWatermark: timestamp('source_high_watermark', { withTimezone: true }).notNull(),
    ingestBatchId: uuid('ingest_batch_id').references(() => ingestBatches.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceName, table.scopeKey, table.listingType] }),
    index('listing_source_scope_watermarks_batch_idx').on(table.ingestBatchId),
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

export const propertyTileListingFacts = pgTable(
  'property_tile_listing_facts',
  {
    propertyId: uuid('property_id')
      .primaryKey()
      .references(() => properties.id, { onDelete: 'cascade' }),
    hasActiveListing: boolean('has_active_listing').notNull(),
    hasCompletedListing: boolean('has_completed_listing').notNull(),
    marketState: varchar('market_state', { length: 20 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'property_tile_listing_facts_market_state_check',
      sql`${table.marketState} IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed')`,
    ),
  ]
);

export const listingPreviewResults = pgTable(
  'listing_preview_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sourceUrlRaw: text('source_url_raw').notNull(),
    sourceUrlCanonical: text('source_url_canonical').notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    sourceListingIdKind: listingSourceIdKindEnum('source_listing_id_kind'),
    sourceListingAliases: jsonb('source_listing_aliases')
      .$type<Array<{ kind: string; value: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    validationState: varchar('validation_state', { length: 30 }).notNull(),
    matchState: varchar('match_state', { length: 30 }).notNull(),
    reasonCode: varchar('reason_code', { length: 100 }).notNull(),
    propertyMatchKind: listingPropertyMatchKindEnum('property_match_kind').notNull().default('user_selected'),
    lifecycleStatus: listingSourceStatusEnum('lifecycle_status'),
    diagnosticStatus: listingDiagnosticStatusEnum('diagnostic_status'),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    priceCurrency: varchar('price_currency', { length: 3 }),
    listingType: varchar('listing_type', { length: 20 }).notNull().default('unknown'),
    title: text('title'),
    description: text('description'),
    imageUrl: text('image_url'),
    addressNormalized: jsonb('address_normalized').$type<Record<string, unknown> | null>(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_preview_results_idempotency_idx').on(table.idempotencyKey),
    index('listing_preview_results_property_idx').on(table.propertyId),
    index('listing_preview_results_source_url_idx').on(table.sourceName, table.sourceUrlCanonical),
    check(
      'listing_preview_results_lifecycle_status_check',
      sql`${table.lifecycleStatus} IS NULL OR ${table.lifecycleStatus} IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')`,
    ),
  ]
);

export const listingCandidateHandoffs = pgTable(
  'listing_candidate_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    previewResultId: uuid('preview_result_id').references(() => listingPreviewResults.id, { onDelete: 'set null' }),
    canonicalListingId: uuid('canonical_listing_id').references(() => canonicalListings.id, { onDelete: 'cascade' }),
    observationId: uuid('observation_id').references((): AnyPgColumn => listingObservations.id, { onDelete: 'set null' }),
    sourceName: varchar('source_name', { length: 50 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    sourceUrlRaw: text('source_url_raw').notNull(),
    sourceUrlCanonical: text('source_url_canonical').notNull(),
    sourceListingId: varchar('source_listing_id', { length: 255 }),
    previewFacts: jsonb('preview_facts').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    matchEvidence: jsonb('match_evidence').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    state: listingCandidateHandoffStateEnum('state').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_candidate_handoffs_active_url_idx')
      .on(table.sourceName, table.propertyId, table.sourceUrlCanonical)
      .where(sql`state IN ('pending', 'queued', 'retryable_error')`),
    index('listing_candidate_handoffs_state_next_attempt_idx').on(table.state, table.nextAttemptAt),
    index('listing_candidate_handoffs_canonical_listing_idx').on(table.canonicalListingId),
    index('listing_candidate_handoffs_observation_idx').on(table.observationId),
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
    sourceStatus: listingSourceStatusEnum('source_status'),
    diagnosticStatus: listingDiagnosticStatusEnum('diagnostic_status'),
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
    scopeCompletionId: uuid('scope_completion_id').references(() => listingScopeCompletions.id, { onDelete: 'set null' }),
    sourceRunId: varchar('source_run_id', { length: 255 }),
    sourceHighWatermark: timestamp('source_high_watermark', { withTimezone: true }),
    staleForProjection: boolean('stale_for_projection').notNull().default(false),
    previewResultId: uuid('preview_result_id').references(() => listingPreviewResults.id, { onDelete: 'set null' }),
    candidateHandoffId: uuid('candidate_handoff_id').references(() => listingCandidateHandoffs.id, { onDelete: 'set null' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_observations_mirror_idempotency_idx')
      .on(table.sourceName, table.sourceListingId, table.origin, table.observedAt)
      .where(sql`source_listing_id IS NOT NULL`),
    uniqueIndex('listing_observations_source_url_evidence_idx')
      .on(table.sourceName, table.sourceUrlCanonical, table.origin, table.observedAt)
      .where(sql`source_listing_id IS NULL AND source_url_canonical IS NOT NULL`),
    index('listing_observations_source_identity_idx').on(table.sourceName, table.sourceListingId),
    index('listing_observations_source_url_idx').on(table.sourceName, table.sourceUrlCanonical),
    index('listing_observations_property_id_idx').on(table.propertyId),
    index('listing_observations_ingest_batch_idx').on(table.ingestBatchId),
    index('listing_observations_completion_idx').on(table.scopeCompletionId),
    index('listing_observations_stale_projection_idx').on(table.staleForProjection),
    index('listing_observations_preview_idx').on(table.previewResultId),
    index('listing_observations_candidate_handoff_idx').on(table.candidateHandoffId),
    check(
      'listing_observations_source_status_lifecycle_check',
      sql`${table.sourceStatus} IS NULL OR ${table.sourceStatus} IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')`,
    ),
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
    sourceStatus: listingSourceStatusEnum('source_status'),
    diagnosticStatus: listingDiagnosticStatusEnum('diagnostic_status'),
    staleForProjection: boolean('stale_for_projection').notNull().default(false),
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
    check(
      'listing_replay_staging_source_status_lifecycle_check',
      sql`${table.sourceStatus} IS NULL OR ${table.sourceStatus} IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')`,
    ),
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

export const propertyTilePyramidVersions = pgTable(
  'property_tile_pyramid_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coverageId: text('coverage_id').notNull(),
    filterSignature: text('filter_signature').notNull(),
    maxZoom: integer('max_zoom').notNull(),
    pyramidKind: propertyTilePyramidKindEnum('pyramid_kind')
      .notNull()
      .default('public_default_low_zoom'),
    configHash: text('config_hash').notNull(),
    buildInputsHash: text('build_inputs_hash').notNull(),
    sourceWatermarkHash: text('source_watermark_hash').notNull(),
    sourceWatermarksJson: jsonb('source_watermarks_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    coverageSnapshotJson: jsonb('coverage_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    configSnapshotJson: jsonb('config_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    groupingConstantsJson: jsonb('grouping_constants_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    validationSummary: jsonb('validation_summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    buildStatsJson: jsonb('build_stats_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: propertyTilePyramidVersionStatusEnum('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    requestReason: text('request_reason'),
    failureCategory: text('failure_category'),
    failureMessage: text('failure_message'),
    failureStackSummary: text('failure_stack_summary'),
    failedStage: text('failed_stage'),
    failedZ: integer('failed_z'),
    failedX: integer('failed_x'),
    failedY: integer('failed_y'),
    terminalReason: text('terminal_reason'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    leaseToken: text('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    pendingReplacementWatermarksJson: jsonb('pending_replacement_watermarks_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    expectedTileCount: integer('expected_tile_count').notNull().default(0),
    validatedTileCount: integer('validated_tile_count').notNull().default(0),
    nonEmptyTileCount: integer('non_empty_tile_count').notNull().default(0),
    nodeCount: integer('node_count').notNull().default(0),
    memberRowCount: bigint('member_row_count', { mode: 'bigint' }).notNull().default(0n),
    encodedPayloadBytes: bigint('encoded_payload_bytes', { mode: 'bigint' }).notNull().default(0n),
    heapBytes: bigint('heap_bytes', { mode: 'bigint' }).notNull().default(0n),
    indexBytes: bigint('index_bytes', { mode: 'bigint' }).notNull().default(0n),
    walBytes: bigint('wal_bytes', { mode: 'bigint' }).notNull().default(0n),
    buildDurationMs: integer('build_duration_ms'),
    degradedAt: timestamp('degraded_at', { withTimezone: true }),
    degradedReason: text('degraded_reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    buildStartedAt: timestamp('build_started_at', { withTimezone: true }),
    buildFinishedAt: timestamp('build_finished_at', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_tile_pyramid_versions_build_identity_idx').on(
      table.coverageId,
      table.filterSignature,
      table.maxZoom,
      table.pyramidKind,
      table.buildInputsHash,
      table.sourceWatermarkHash
    ),
    uniqueIndex('property_tile_pyramid_versions_current_fk_idx').on(
      table.id,
      table.coverageId,
      table.filterSignature,
      table.maxZoom,
      table.pyramidKind
    ),
    index('property_tile_pyramid_versions_slot_status_idx').on(
      table.coverageId,
      table.filterSignature,
      table.maxZoom,
      table.pyramidKind,
      table.status,
      sql`created_at DESC`
    ),
    uniqueIndex('property_tile_pyramid_versions_active_slot_idx')
      .on(table.coverageId, table.filterSignature, table.maxZoom, table.pyramidKind)
      .where(sql`status IN ('queued', 'building', 'validating')`),
    index('property_tile_pyramid_versions_eligible_idx')
      .on(table.status, table.nextRetryAt, table.requestedAt)
      .where(sql`status IN ('queued', 'failed_retryable')`),
    index('property_tile_pyramid_versions_lease_idx')
      .on(table.leaseUntil, table.status)
      .where(sql`lease_until IS NOT NULL`),
    index('property_tile_pyramid_versions_retention_idx').on(
      table.status,
      table.promotedAt,
      table.createdAt
    ),
    check(
      'property_tile_pyramid_versions_zoom_check',
      sql`${table.maxZoom} >= 0 AND ${table.maxZoom} <= 22`,
    ),
    check(
      'property_tile_pyramid_versions_counts_check',
      sql`${table.attemptCount} >= 0
        AND ${table.maxAttempts} > 0
        AND ${table.expectedTileCount} >= 0
        AND ${table.validatedTileCount} >= 0
        AND ${table.nonEmptyTileCount} >= 0
        AND ${table.nodeCount} >= 0
        AND ${table.memberRowCount} >= 0
        AND ${table.encodedPayloadBytes} >= 0
        AND ${table.heapBytes} >= 0
        AND ${table.indexBytes} >= 0
        AND ${table.walBytes} >= 0
        AND (${table.buildDurationMs} IS NULL OR ${table.buildDurationMs} >= 0)`,
    ),
    check(
      'property_tile_pyramid_versions_status_timestamps_check',
      sql`(${table.status} = 'promoted') = (${table.promotedAt} IS NOT NULL)
        AND (${table.status} <> 'failed_terminal' OR ${table.terminalReason} IS NOT NULL)`,
    ),
    check(
      'property_tile_pyramid_versions_failed_tile_check',
      sql`(${table.failedZ} IS NULL AND ${table.failedX} IS NULL AND ${table.failedY} IS NULL)
        OR (
          ${table.failedZ} IS NOT NULL
          AND ${table.failedX} IS NOT NULL
          AND ${table.failedY} IS NOT NULL
          AND ${table.failedZ} >= 0
          AND ${table.failedZ} <= 22
          AND ${table.failedX} >= 0
          AND ${table.failedY} >= 0
          AND ${table.failedX} < (1::bigint << ${table.failedZ})
          AND ${table.failedY} < (1::bigint << ${table.failedZ})
        )`,
    ),
  ],
);

export const propertyTilePyramidCurrent = pgTable(
  'property_tile_pyramid_current',
  {
    coverageId: text('coverage_id').notNull(),
    filterSignature: text('filter_signature').notNull(),
    maxZoom: integer('max_zoom').notNull(),
    pyramidKind: propertyTilePyramidKindEnum('pyramid_kind')
      .notNull()
      .default('public_default_low_zoom'),
    currentVersionId: uuid('current_version_id').notNull(),
    previousVersionId: uuid('previous_version_id').references(() => propertyTilePyramidVersions.id, {
      onDelete: 'set null',
    }),
    currentPromotedAt: timestamp('current_promoted_at', { withTimezone: true }).notNull(),
    promotionReason: text('promotion_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.coverageId, table.filterSignature, table.maxZoom, table.pyramidKind],
    }),
    foreignKey({
      name: 'property_tile_pyramid_current_version_fk',
      columns: [
        table.currentVersionId,
        table.coverageId,
        table.filterSignature,
        table.maxZoom,
        table.pyramidKind,
      ],
      foreignColumns: [
        propertyTilePyramidVersions.id,
        propertyTilePyramidVersions.coverageId,
        propertyTilePyramidVersions.filterSignature,
        propertyTilePyramidVersions.maxZoom,
        propertyTilePyramidVersions.pyramidKind,
      ],
    }),
    index('property_tile_pyramid_current_version_idx').on(table.currentVersionId),
    index('property_tile_pyramid_current_previous_idx').on(table.previousVersionId),
    check(
      'property_tile_pyramid_current_zoom_check',
      sql`${table.maxZoom} >= 0 AND ${table.maxZoom} <= 22`,
    ),
  ],
);

export const propertyTilePyramidTiles = pgTable(
  'property_tile_pyramid_tiles',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => propertyTilePyramidVersions.id, { onDelete: 'cascade' }),
    z: integer('z').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    tileStatus: propertyTilePyramidTileStatusEnum('tile_status').notNull().default('pending'),
    validationStatus: propertyTilePyramidTileValidationStatusEnum('validation_status')
      .notNull()
      .default('pending'),
    nodeCount: integer('node_count').notNull().default(0),
    etag: text('etag'),
    payload: bytea('payload'),
    payloadSha256: text('payload_sha256'),
    payloadGeneratedAt: timestamp('payload_generated_at', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.z, table.x, table.y] }),
    index('property_tile_pyramid_tiles_status_idx').on(
      table.versionId,
      table.tileStatus,
      table.validationStatus,
      table.z,
      table.x,
      table.y
    ),
    index('property_tile_pyramid_tiles_payload_missing_idx')
      .on(table.versionId, table.z, table.x, table.y)
      .where(sql`tile_status = 'valid_nodes' AND payload IS NULL`),
    index('property_tile_pyramid_tiles_payload_retention_idx')
      .on(table.versionId, table.payloadGeneratedAt)
      .where(sql`payload IS NOT NULL`),
    index('property_tile_pyramid_tiles_promotion_invalid_idx')
      .on(table.versionId)
      .where(sql`validation_status <> 'validated'
        OR tile_status NOT IN ('valid_empty', 'valid_nodes', 'valid_encoded')`),
    check(
      'property_tile_pyramid_tiles_coord_check',
      sql`${table.z} >= 0
        AND ${table.z} <= 22
        AND ${table.x} >= 0
        AND ${table.y} >= 0
        AND ${table.x} < (1::bigint << ${table.z})
        AND ${table.y} < (1::bigint << ${table.z})`,
    ),
    check(
      'property_tile_pyramid_tiles_payload_check',
      sql`${table.nodeCount} >= 0
        AND (
          (${table.tileStatus} = 'pending' AND ${table.payload} IS NULL)
          OR (
            ${table.tileStatus} = 'valid_empty'
            AND ${table.nodeCount} = 0
            AND ${table.payload} IS NULL
            AND ${table.etag} IS NOT NULL
          )
          OR (
            ${table.tileStatus} = 'valid_nodes'
            AND ${table.nodeCount} > 0
            AND ${table.payload} IS NULL
            AND ${table.etag} IS NOT NULL
          )
          OR (
            ${table.tileStatus} = 'valid_encoded'
            AND ${table.payload} IS NOT NULL
            AND octet_length(${table.payload}) > 0
            AND ${table.etag} IS NOT NULL
            AND ${table.payloadSha256} IS NOT NULL
            AND ${table.payloadGeneratedAt} IS NOT NULL
          )
          OR (${table.tileStatus} = 'failed' AND ${table.payload} IS NULL)
        )`,
    ),
    check(
      'property_tile_pyramid_tiles_validation_check',
      sql`(${table.validationStatus} <> 'validated' OR ${table.validatedAt} IS NOT NULL)
        AND (${table.validationStatus} <> 'failed' OR ${table.lastError} IS NOT NULL)`,
    ),
  ],
);

export const propertyTilePyramidNodes = pgTable(
  'property_tile_pyramid_nodes',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => propertyTilePyramidVersions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    z: integer('z').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    renderLon: doublePrecision('render_lon').notNull(),
    renderLat: doublePrecision('render_lat').notNull(),
    renderGeometry: geometry('render_geometry').notNull(),
    anchorWorldX: doublePrecision('anchor_world_x').notNull(),
    anchorWorldY: doublePrecision('anchor_world_y').notNull(),
    nodeClass: propertyTilePyramidNodeClassEnum('node_class').notNull(),
    groupKind: propertyTilePyramidGroupKindEnum('group_kind').notNull(),
    pointCount: integer('point_count').notNull(),
    representativePropertyId: uuid('representative_property_id'),
    previewPropertyIds: uuid('preview_property_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    previewCount: integer('preview_count').notNull().default(0),
    nodeSummaryJson: jsonb('node_summary_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    previewPropertiesJson: jsonb('preview_properties_json')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    bboxWest: doublePrecision('bbox_west'),
    bboxSouth: doublePrecision('bbox_south'),
    bboxEast: doublePrecision('bbox_east'),
    bboxNorth: doublePrecision('bbox_north'),
    activeListingCount: integer('active_listing_count').notNull().default(0),
    completedListingCount: integer('completed_listing_count').notNull().default(0),
    socialCount: integer('social_count').notNull().default(0),
    recentSocialCount: integer('recent_social_count').notNull().default(0),
    socialScoreTotal: real('social_score_total').notNull().default(0),
    socialScoreMax: real('social_score_max').notNull().default(0),
    recentSocialScoreTotal: real('recent_social_score_total').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    address: text('address'),
    city: text('city'),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    thumbnailUrl: text('thumbnail_url'),
    hasActiveListing: boolean('has_active_listing'),
    marketState: varchar('market_state', { length: 20 }),
    tapRadiusPx: real('tap_radius_px'),
    tapPriorityScore: real('tap_priority_score').notNull().default(0),
    nearbyMetadataJson: jsonb('nearby_metadata_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.nodeId] }),
    index('property_tile_pyramid_nodes_tile_idx').on(table.versionId, table.z, table.x, table.y),
    index('property_tile_pyramid_nodes_nearby_tile_idx').on(
      table.versionId,
      table.z,
      table.x,
      table.y,
      table.renderLon,
      table.renderLat
    ),
    index('property_tile_pyramid_nodes_render_geometry_idx').using('gist', table.renderGeometry),
    index('property_tile_pyramid_nodes_representative_idx').on(
      table.versionId,
      table.representativePropertyId
    ),
    check(
      'property_tile_pyramid_nodes_coord_check',
      sql`${table.z} >= 0
        AND ${table.z} <= 22
        AND ${table.x} >= 0
        AND ${table.y} >= 0
        AND ${table.x} < (1::bigint << ${table.z})
        AND ${table.y} < (1::bigint << ${table.z})
        AND ${table.renderLon} >= -180
        AND ${table.renderLon} <= 180
        AND ${table.renderLat} >= -90
        AND ${table.renderLat} <= 90`,
    ),
    check(
      'property_tile_pyramid_nodes_counts_check',
      sql`${table.pointCount} > 0
        AND ${table.previewCount} >= 0
        AND ${table.previewCount} <= ${table.pointCount}
        AND ${table.previewCount} = cardinality(${table.previewPropertyIds})
        AND ${table.activeListingCount} >= 0
        AND ${table.completedListingCount} >= 0
        AND ${table.socialCount} >= 0
        AND ${table.recentSocialCount} >= 0
        AND ${table.socialScoreTotal} >= 0
        AND ${table.socialScoreMax} >= 0
        AND ${table.recentSocialScoreTotal} >= 0
        AND ${table.commentCount} >= 0
        AND (${table.tapRadiusPx} IS NULL OR ${table.tapRadiusPx} >= 0)
        AND ${table.tapPriorityScore} >= 0`,
    ),
    check(
      'property_tile_pyramid_nodes_bbox_check',
      sql`(
          ${table.bboxWest} IS NULL
          AND ${table.bboxSouth} IS NULL
          AND ${table.bboxEast} IS NULL
          AND ${table.bboxNorth} IS NULL
        )
        OR (
          ${table.bboxWest} IS NOT NULL
          AND ${table.bboxSouth} IS NOT NULL
          AND ${table.bboxEast} IS NOT NULL
          AND ${table.bboxNorth} IS NOT NULL
          AND ${table.bboxWest} <= ${table.bboxEast}
          AND ${table.bboxSouth} <= ${table.bboxNorth}
          AND ${table.bboxWest} >= -180
          AND ${table.bboxEast} <= 180
          AND ${table.bboxSouth} >= -90
          AND ${table.bboxNorth} <= 90
        )`,
    ),
    check(
      'property_tile_pyramid_nodes_market_state_check',
      sql`${table.marketState} IS NULL
        OR ${table.marketState} IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed')`,
    ),
  ],
);

export const propertyTilePyramidSourceWatermarks = pgTable(
  'property_tile_pyramid_source_watermarks',
  {
    scope: propertyTilePyramidWatermarkScopeEnum('scope').notNull(),
    scopeKey: text('scope_key').notNull().default('global'),
    watermarkValue: bigint('watermark_value', { mode: 'bigint' }).notNull().default(0n),
    watermarkTimestamp: timestamp('watermark_timestamp', { withTimezone: true }),
    watermarkJson: jsonb('watermark_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    pendingReplacementWatermarkValue: bigint('pending_replacement_watermark_value', {
      mode: 'bigint',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.scopeKey] }),
    index('property_tile_pyramid_watermarks_updated_idx').on(table.updatedAt),
    check(
      'property_tile_pyramid_watermarks_value_check',
      sql`${table.watermarkValue} >= 0
        AND (
          ${table.pendingReplacementWatermarkValue} IS NULL
          OR ${table.pendingReplacementWatermarkValue} >= ${table.watermarkValue}
        )`,
    ),
  ],
);

export const propertyTilePyramidAudit = pgTable(
  'property_tile_pyramid_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id').references(() => propertyTilePyramidVersions.id, {
      onDelete: 'set null',
    }),
    coverageId: text('coverage_id').notNull(),
    filterSignature: text('filter_signature').notNull(),
    maxZoom: integer('max_zoom').notNull(),
    pyramidKind: propertyTilePyramidKindEnum('pyramid_kind')
      .notNull()
      .default('public_default_low_zoom'),
    action: propertyTilePyramidAuditActionEnum('action').notNull(),
    actor: text('actor').notNull().default('system'),
    fromStatus: propertyTilePyramidVersionStatusEnum('from_status'),
    toStatus: propertyTilePyramidVersionStatusEnum('to_status'),
    previousVersionId: uuid('previous_version_id'),
    currentVersionId: uuid('current_version_id'),
    reason: text('reason'),
    detailsJson: jsonb('details_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('property_tile_pyramid_audit_version_idx').on(table.versionId, table.createdAt),
    index('property_tile_pyramid_audit_slot_idx').on(
      table.coverageId,
      table.filterSignature,
      table.maxZoom,
      table.pyramidKind,
      table.createdAt
    ),
    check(
      'property_tile_pyramid_audit_zoom_check',
      sql`${table.maxZoom} >= 0 AND ${table.maxZoom} <= 22`,
    ),
  ],
);

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

export const propertyReadStateVersions = pgTable(
  'property_read_state_versions',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_read_state_versions_user_idx')
      .on(table.userId)
      .where(sql`user_id IS NOT NULL AND session_id IS NULL`),
    uniqueIndex('property_read_state_versions_session_idx')
      .on(table.sessionId)
      .where(sql`session_id IS NOT NULL AND user_id IS NULL`),
    check(
      'property_read_state_versions_exactly_one_identity_chk',
      sql`(${table.userId} IS NULL) <> (${table.sessionId} IS NULL)`,
    ),
    check(
      'property_read_state_versions_session_not_blank_chk',
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
  listingPreviewResults: many(listingPreviewResults),
  listingCandidateHandoffs: many(listingCandidateHandoffs),
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
  listingPreviewResults: many(listingPreviewResults),
  listingCandidateHandoffs: many(listingCandidateHandoffs),
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
  candidateHandoffs: many(listingCandidateHandoffs),
}));

export const listingPreviewResultsRelations = relations(listingPreviewResults, ({ one }) => ({
  property: one(properties, {
    fields: [listingPreviewResults.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [listingPreviewResults.userId],
    references: [users.id],
  }),
}));

export const listingCandidateHandoffsRelations = relations(listingCandidateHandoffs, ({ one }) => ({
  property: one(properties, {
    fields: [listingCandidateHandoffs.propertyId],
    references: [properties.id],
  }),
  submittedByUser: one(users, {
    fields: [listingCandidateHandoffs.submittedBy],
    references: [users.id],
  }),
  canonicalListing: one(canonicalListings, {
    fields: [listingCandidateHandoffs.canonicalListingId],
    references: [canonicalListings.id],
  }),
  previewResult: one(listingPreviewResults, {
    fields: [listingCandidateHandoffs.previewResultId],
    references: [listingPreviewResults.id],
  }),
  observation: one(listingObservations, {
    fields: [listingCandidateHandoffs.observationId],
    references: [listingObservations.id],
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
  scopeCompletion: one(listingScopeCompletions, {
    fields: [listingObservations.scopeCompletionId],
    references: [listingScopeCompletions.id],
  }),
  previewResult: one(listingPreviewResults, {
    fields: [listingObservations.previewResultId],
    references: [listingPreviewResults.id],
  }),
  candidateHandoff: one(listingCandidateHandoffs, {
    fields: [listingObservations.candidateHandoffId],
    references: [listingCandidateHandoffs.id],
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
  scopeCompletions: many(listingScopeCompletions),
}));

export const ingestSourcesRelations = relations(ingestSources, ({ one }) => ({
  lastBatch: one(ingestBatches, {
    fields: [ingestSources.lastBatchId],
    references: [ingestBatches.id],
  }),
}));

export const listingScopeCompletionsRelations = relations(listingScopeCompletions, ({ one, many }) => ({
  ingestBatch: one(ingestBatches, {
    fields: [listingScopeCompletions.ingestBatchId],
    references: [ingestBatches.id],
  }),
  observations: many(listingObservations),
}));

export const listingSourceScopeWatermarksRelations = relations(listingSourceScopeWatermarks, ({ one }) => ({
  ingestBatch: one(ingestBatches, {
    fields: [listingSourceScopeWatermarks.ingestBatchId],
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

export type ListingScopeCompletion = typeof listingScopeCompletions.$inferSelect;
export type NewListingScopeCompletion = typeof listingScopeCompletions.$inferInsert;

export type ListingPreviewResult = typeof listingPreviewResults.$inferSelect;
export type NewListingPreviewResult = typeof listingPreviewResults.$inferInsert;

export type ListingCandidateHandoff = typeof listingCandidateHandoffs.$inferSelect;
export type NewListingCandidateHandoff = typeof listingCandidateHandoffs.$inferInsert;

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
