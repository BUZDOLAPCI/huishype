/**
 * Shared Zod validation schemas for HuisHype
 * Used by both frontend and backend for consistent validation
 */

import { z } from 'zod';
import { getCountryConfig, getAllListingDomains, getAllListingSourceNames, type CountryCode } from '../config/country-config.js';

// ============================================
// Primitive Schemas
// ============================================

/** UUID v4 format */
export const idSchema = z.string().uuid();

/** Dutch postal code format (1234 AB) — legacy, prefer validatePostalCode() */
export const postalCodeSchema = z
  .string()
  .regex(/^\d{4}\s?[A-Z]{2}$/, 'Invalid Dutch postal code format');

/**
 * Validate a postal code against the country-config regex.
 * Trims and uppercases the input before testing.
 */
export function validatePostalCode(code: string, countryCode: CountryCode = 'NL'): boolean {
  const cfg = getCountryConfig(countryCode);
  return cfg.postalCodeRegex.test(code.trim().toUpperCase());
}

/**
 * Normalize a postal code using the country-config normalizer.
 * Returns the canonical form (e.g. "1234AB" → "1234 AB" for NL).
 */
export function normalizePostalCode(code: string, countryCode: CountryCode = 'NL'): string {
  return getCountryConfig(countryCode).postalCodeNormalize(code);
}

/**
 * Create a Zod schema for postal code validation for a specific country.
 */
export function postalCodeSchemaForCountry(countryCode: CountryCode) {
  const cfg = getCountryConfig(countryCode);
  return z.string().refine(
    (val) => cfg.postalCodeRegex.test(val.trim().toUpperCase()),
    `Invalid postal code format for ${cfg.name}`,
  );
}

/** Username: alphanumeric, underscores, 3-20 chars */
export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username can only contain letters, numbers, and underscores'
  );

/** Display name: 1-50 chars */
export const displayNameSchema = z
  .string()
  .min(1, 'Display name is required')
  .max(50, 'Display name must be at most 50 characters')
  .trim();

/** Price in euros (positive integer) */
export const priceSchema = z
  .number()
  .int('Price must be a whole number')
  .positive('Price must be positive')
  .max(100_000_000, 'Price exceeds maximum value');

/** Coordinates */
export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/** Map bounds */
export const mapBoundsSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
});

// ============================================
// Auth Schemas
// ============================================

export const authProviderSchema = z.enum(['google', 'apple']);

export const authLoginSchema = z.object({
  provider: authProviderSchema,
  idToken: z.string().min(1, 'ID token is required'),
});

export const authRefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ============================================
// User Schemas
// ============================================

export const updateUserProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
});

// ============================================
// Property Schemas
// ============================================

export const activityLevelSchema = z.enum(['cold', 'warm', 'hot']);

export const getMapPropertiesSchema = z.object({
  bounds: mapBoundsSchema,
  zoom: z.number().min(1).max(22),
  filters: z
    .object({
      minPrice: priceSchema.optional(),
      maxPrice: priceSchema.optional(),
      minSize: z.number().int().positive().optional(),
      maxSize: z.number().int().positive().optional(),
      activityLevel: z.array(activityLevelSchema).optional(),
      hasListing: z.boolean().optional(),
    })
    .optional(),
});

// ============================================
// Listing Schemas
// ============================================

/** All valid listing source names from the country-config registry, plus 'other' as fallback. */
const ALL_LISTING_SOURCES = [...getAllListingSourceNames(), 'other'] as const;

export const listingSourceSchema = z.string().refine(
  (val) => (ALL_LISTING_SOURCES as readonly string[]).includes(val),
  { message: `Must be one of: ${ALL_LISTING_SOURCES.join(', ')}` },
);

/** All listing domains from the country-config registry (cached at import time). */
const LISTING_DOMAINS = getAllListingDomains();

export const submitListingSchema = z.object({
  url: z
    .string()
    .url('Invalid URL')
    .refine(
      (url) => {
        const hostname = new URL(url).hostname.toLowerCase();
        return LISTING_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );
      },
      'URL must be from a recognized listing platform',
    ),
});

export const getListingsSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['newest', 'price_asc', 'price_desc', 'most_active'])
    .default('newest'),
  city: z.string().max(100).optional(),
  minPrice: priceSchema.optional(),
  maxPrice: priceSchema.optional(),
});

// ============================================
// Guess Schemas
// ============================================

export const submitGuessSchema = z.object({
  propertyId: idSchema,
  guessedPrice: priceSchema,
});

export const updateGuessSchema = z.object({
  guessedPrice: priceSchema,
});

// ============================================
// Comment Schemas
// ============================================

export const commentContentSchema = z
  .string()
  .min(1, 'Comment cannot be empty')
  .max(500, 'Comment must be at most 500 characters')
  .trim();

export const commentSortSchema = z.enum([
  'popular_recent',
  'newest',
  'oldest',
  'most_liked',
]);

export const createCommentSchema = z.object({
  propertyId: idSchema,
  content: commentContentSchema,
  parentId: idSchema.optional(),
});

export const updateCommentSchema = z.object({
  content: commentContentSchema,
});

export const getCommentsSchema = z.object({
  propertyId: idSchema,
  sort: commentSortSchema.default('popular_recent'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// ============================================
// Reaction Schemas
// ============================================

export const reactionTypeSchema = z.enum(['like', 'share']);

// ============================================
// Feed Schemas
// ============================================

export const feedTypeSchema = z.enum([
  'trending',
  'new',
  'controversial',
  'overpriced',
  'underpriced',
]);

export const getFeedSchema = z.object({
  type: feedTypeSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  city: z.string().max(100).optional(),
});

// ============================================
// Pagination Schemas
// ============================================

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
