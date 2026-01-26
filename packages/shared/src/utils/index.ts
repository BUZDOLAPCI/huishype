/**
 * Utility exports for @huishype/shared
 */

// Validation schemas
export {
  // Primitives
  idSchema,
  postalCodeSchema,
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
  searchPropertiesSchema,
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
  toggleReactionSchema,
  // Feed
  feedTypeSchema,
  getFeedSchema,
  // Pagination
  paginationSchema,
  cursorPaginationSchema,
} from './validation';

// Formatting utilities
export {
  formatPrice,
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
  truncateText,
} from './formatting';
