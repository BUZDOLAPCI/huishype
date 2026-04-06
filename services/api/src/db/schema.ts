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
  serial,
  real,
  jsonb,
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
  'failed',
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
    officialValuation: bigint('official_valuation', { mode: 'number' }), // Official government valuation (e.g. WOZ for NL)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('properties_national_id_idx').on(table.countryCode, table.nationalId),
    index('properties_city_idx').on(table.city),
    index('properties_postal_code_idx').on(table.postalCode),
    uniqueIndex('properties_address_unique_idx').on(table.countryCode, table.street, table.postalCode, table.houseNumber, table.houseNumberAddition),
    index('properties_created_at_idx').on(table.createdAt),
    index('properties_country_code_idx').on(table.countryCode),
    index('properties_geometry_gist_idx').using('gist', table.geometry),
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
    source: varchar('source', { length: 20 }).notNull(), // funda / pararius / observed / woz
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('price_history_property_date_idx').on(table.propertyId, table.priceDate),
    uniqueIndex('price_history_dedup_idx').on(table.propertyId, table.priceDate, table.price, table.eventType),
    index('price_history_listing_idx').on(table.listingId),
  ]
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

// Notification event types
export const notificationEventTypeEnum = pgEnum('notification_event_type', [
  'property_comment',       // Someone commented on a property you interacted with
  'comment_reply',          // Someone replied to your comment
  'comment_like',           // Someone liked your comment
  'property_like',          // Someone liked a property you own/listed
  'property_guess',         // Someone guessed on a property you interacted with
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
  propertyViews: many(propertyViews),
  notifications: many(notifications, { relationName: 'recipientNotifications' }),
  pushTokens: many(pushTokens),
  achievements: many(userAchievements),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  listings: many(listings),
  priceGuesses: many(priceGuesses),
  comments: many(comments),
  savedProperties: many(savedProperties),
  priceHistory: many(priceHistory),
  propertyViews: many(propertyViews),
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

export const ingestRunsRelations = relations(ingestRuns, ({ many }) => ({
  batches: many(ingestBatches),
}));

export const ingestBatchesRelations = relations(ingestBatches, ({ one }) => ({
  run: one(ingestRuns, {
    fields: [ingestBatches.runId],
    references: [ingestRuns.id],
  }),
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

export type PriceGuess = typeof priceGuesses.$inferSelect;
export type NewPriceGuess = typeof priceGuesses.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;

export type SavedProperty = typeof savedProperties.$inferSelect;
export type NewSavedProperty = typeof savedProperties.$inferInsert;

export type PriceHistory = typeof priceHistory.$inferSelect;
export type NewPriceHistory = typeof priceHistory.$inferInsert;

export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;

export type IngestBatch = typeof ingestBatches.$inferSelect;
export type NewIngestBatch = typeof ingestBatches.$inferInsert;

export type IngestSource = typeof ingestSources.$inferSelect;
export type NewIngestSource = typeof ingestSources.$inferInsert;

export type PropertyView = typeof propertyViews.$inferSelect;
export type NewPropertyView = typeof propertyViews.$inferInsert;

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
