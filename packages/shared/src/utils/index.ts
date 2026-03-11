/**
 * Utility exports for @huishype/shared
 */

// Validation schemas
export {
  // Primitives
  idSchema,
  postalCodeSchema,
  validatePostalCode,
  normalizePostalCode,
  postalCodeSchemaForCountry,
  usernameSchema,
  displayNameSchema,
  priceSchema,
  coordinatesSchema,
  mapBoundsSchema,
  // Auth
  authProviderSchema,
  authLoginSchema,
  authRefreshSchema,
  // User
  updateUserProfileSchema,
  // Property
  activityLevelSchema,
  getMapPropertiesSchema,
  // Listing
  listingSourceSchema,
  submitListingSchema,
  getListingsSchema,
  // Guess
  submitGuessSchema,
  updateGuessSchema,
  // Comment
  commentContentSchema,
  commentSortSchema,
  createCommentSchema,
  updateCommentSchema,
  getCommentsSchema,
  // Reaction
  reactionTypeSchema,
  // Feed
  feedTypeSchema,
  getFeedSchema,
  // Pagination
  paginationSchema,
  cursorPaginationSchema,
} from './validation.js';

// Formatting utilities
export {
  formatPrice,
  formatPropertyPrice,
  formatPriceRange,
  formatPercentage,
  formatRelativeTime,
  formatDate,
  formatPostalCode,
  formatAddress,
  formatArea,
  formatNumber,
  formatKarma,
  getKarmaRank,
  getValuationLabel,
  truncateText,
} from './formatting.js';
