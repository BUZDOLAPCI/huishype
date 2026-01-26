import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

// Enums
export const reactionTypeEnum = pgEnum('reaction_type', ['like', 'love', 'wow', 'angry']);
export const targetTypeEnum = pgEnum('target_type', ['property', 'comment']);
export const listingSourceEnum = pgEnum('listing_source', ['funda', 'pararius', 'other']);
export const propertyStatusEnum = pgEnum('property_status', ['active', 'inactive', 'demolished']);

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

// Properties table (addresses from BAG)
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bagIdentificatie: varchar('bag_identificatie', { length: 50 }).unique(), // BAG ID
    address: varchar('address', { length: 255 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    geometry: geometry('geometry'),
    bouwjaar: integer('bouwjaar'), // Construction year
    oppervlakte: integer('oppervlakte'), // Surface area in m2
    status: propertyStatusEnum('status').notNull().default('active'),
    wozValue: bigint('woz_value', { mode: 'number' }), // Official government valuation
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('properties_bag_id_idx').on(table.bagIdentificatie),
    index('properties_city_idx').on(table.city),
    index('properties_postal_code_idx').on(table.postalCode),
    // PostGIS spatial index would be created via raw SQL migration
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
    sourceName: listingSourceEnum('source_name').notNull(),
    askingPrice: bigint('asking_price', { mode: 'number' }),
    thumbnailUrl: text('thumbnail_url'),
    ogTitle: text('og_title'), // Open Graph title
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('listings_property_id_idx').on(table.propertyId),
    index('listings_is_active_idx').on(table.isActive),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('price_guesses_property_id_idx').on(table.propertyId),
    index('price_guesses_user_id_idx').on(table.userId),
    // Unique constraint: one guess per user per property (updates allowed with cooldown)
    uniqueIndex('price_guesses_user_property_idx').on(table.userId, table.propertyId),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  priceGuesses: many(priceGuesses),
  comments: many(comments),
  reactions: many(reactions),
  savedProperties: many(savedProperties),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  listings: many(listings),
  priceGuesses: many(priceGuesses),
  comments: many(comments),
  savedProperties: many(savedProperties),
}));

export const listingsRelations = relations(listings, ({ one }) => ({
  property: one(properties, {
    fields: [listings.propertyId],
    references: [properties.id],
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
