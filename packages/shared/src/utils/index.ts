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
  normalizeHandle,
  handleSchema,
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
  // Listing
  listingSourceSchema,
  previewListingSchema,
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
  propertyFeedFilterSchema,
  feedQuerySchema,
  type FeedQuery,
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

// Karma tiers (unified source of truth)
export { KARMA_TIERS, getKarmaTier, type KarmaTier } from './karma-tiers.js';

// Achievement registry (unified source of truth)
export {
  ACHIEVEMENT_REGISTRY,
  getAchievementByKey,
  getAchievementsByCategory,
  ACHIEVEMENT_CATEGORY_LABELS,
} from './achievement-registry.js';

// Shared map-filter helpers
export {
  MAP_FILTER_CATEGORIES,
  MAP_MARKET_STATES,
  MAP_FILTER_QUERY_KEYS,
  isMapMarketState,
  isMapFilterQueryKey,
  createDefaultMapFilters,
  createMapFilterDraftState,
  sanitizeDraftNumber,
  parseDraftNumber,
  normalizeMapMarketState,
  normalizeMapFilters,
  areMapFiltersEqual,
  isMapFilterCategoryActive,
  isMapFilterCategoryDefault,
  areMapFiltersDefault,
  getOrderedMapFilterCategories,
  getMapFilterPillLabel,
  getMapMarketStateLabel,
  getMapFilterPillSummary,
  resetMapFilterCategory,
  serializeLocationFilterToken,
  parseLocationFilterToken,
  mapMarketStateSchema,
  mapFiltersQuerySchema,
  MAP_ACTIVITY_TIME_FILTERS,
  isMapActivityFilter,
  hasOnlyMapFilterQueryParams,
  serializeMapFiltersToSearchParams,
  updateMapFilterSearchParams,
  parseMapFiltersFromSearchParams,
  hasOnlyAllowedMapFilterQueryParams,
  normalizeMapFilterQueryParams,
  getCanonicalMapFilterSignature,
  getMapFilterSearchString,
  normalizeMapFilterSearchString,
  getMapFilterSignature,
  updatePropertyMarketFilterSearchParams,
  updateFollowingPropertyFilterSearchParams,
  serializePropertyMarketFiltersToSearchParams,
  getPropertyMarketFilterSearchString,
  appendSearchToPath,
  buildPropertyTileTemplateUrl,
  buildFollowingPropertyTileTemplateUrl,
  buildNearbyGroupPath,
  buildFollowingNearbyGroupPath,
  buildResolveTapPath,
  getSaleEffectivePrice,
  getRentEffectivePrice,
  type MapFilterDraftState,
} from './map-filters.js';

// Canonical property/map URL helpers
export {
  CANONICAL_LATIN_REPLACEMENTS,
  getCanonicalCountryPrefixSegment,
  getCanonicalCountryPrefix,
  resolveCanonicalCountryPrefix,
  buildCanonicalCitySlug,
  buildCanonicalStreetSlug,
  buildCanonicalPostcodeSlug,
  buildCanonicalHouseSegment,
  normalizeComparableText,
  serializeCanonicalCameraPath,
  parseCanonicalCameraPath,
  isCanonicalMapRoutePath,
  buildCanonicalMapUrl,
  normalizeCanonicalMapUrl,
  buildCanonicalCityMapPath,
  buildCanonicalPostcodeMapPath,
  buildCanonicalPropertyPath,
  buildCanonicalMapPreviewPath,
  buildCanonicalMapCommentsPath,
  buildCanonicalMapGuessesPath,
  buildCanonicalCommentsPath,
  buildCanonicalGuessesPath,
  normalizeInternalReturnTo,
  appendInternalReturnTo,
  type CanonicalMapCamera,
  type CanonicalCountryPrefixResolution,
  type CanonicalMapAreaInput,
  type CanonicalPostcodeMapInput,
  type CanonicalPropertyRouteInput,
} from './property-url.js';
