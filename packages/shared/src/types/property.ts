/**
 * Property-related types for HuisHype
 * Properties represent addresses sourced from national registries (BAG, Overture, OSM, etc.)
 */

/**
 * Geographic coordinates
 */
export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * Property activity level for map display
 */
export type ActivityLevel = 'cold' | 'warm' | 'hot';

/**
 * Canonical map-node class used by both tiles and nearby fallback.
 */
export type PropertyNodeClass = 'active' | 'ghost';

/**
 * Canonical map-node grouping kind used by both tiles and nearby fallback.
 */
export type PropertyGroupKind = 'single' | 'cluster';

export type MapActivityFilter = 'all' | 'social' | 'recent';

/**
 * Core property information (multi-country)
 */
export interface Property {
  id: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  /** Country-specific national identifier (e.g. BAG identificatie for NL, Overture GERS UUID) */
  nationalId: string;
  /** Full formatted address */
  address: string;
  /** Street name */
  streetName: string;
  /** House number */
  houseNumber: string;
  /** House number addition (e.g., 'A', 'bis') */
  houseNumberAddition?: string;
  /** City name */
  city: string;
  /** Province/state/region */
  region?: string;
  /** Postal code */
  postalCode: string;
  /** Geographic coordinates */
  coordinates: Coordinates;
  /** Year of construction */
  yearBuilt?: number;
  /** Floor area in square meters */
  floorAreaM2?: number;
  /** Official government valuation (e.g. WOZ for NL) */
  officialValuation?: number;
  /** Year of the official valuation */
  officialValuationYear?: number;
  /** Property type (apartment, house, etc.) */
  propertyType?: PropertyType;
}

/**
 * Property types from BAG
 */
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'townhouse'
  | 'villa'
  | 'studio'
  | 'penthouse'
  | 'bungalow'
  | 'farm'
  | 'houseboat'
  | 'other';

/**
 * Property with social and listing data
 */
export interface PropertyDetail extends Property {
  /** Current active listing (if for sale) */
  activeListing?: PropertyListing;
  /** Crowd-estimated Fair Market Value */
  fmv?: PropertyFMV;
  /** Activity metrics */
  activity: PropertyActivity;
  /** Primary photo URL (from listing, user, or Street View fallback) */
  photoUrl?: string;
  /** Photo source */
  photoSource?: 'listing' | 'user' | 'streetview';
  /** Additional photos */
  photos: PropertyPhoto[];
  /** Total number of likes on this property */
  likeCount: number;
  /** Whether the current user has liked this property (false if unauthenticated) */
  isLiked: boolean;
  /** Whether the current user has saved this property (false if unauthenticated) */
  isSaved: boolean;
}

/**
 * Minimal property info for listing/display
 */
export interface PropertySummary {
  id: string;
  address: string;
  city: string;
  postalCode: string;
  coordinates: Coordinates;
  photoUrl?: string;
  askingPrice?: number;
  fmvValue?: number;
  activityLevel: ActivityLevel;
}

/**
 * Property listing reference (when property is for sale)
 */
export interface PropertyListing {
  id: string;
  sourceUrl: string;
  sourceName: string;
  askingPrice: number;
  thumbnailUrl?: string;
  /** When this listing was discovered/added */
  addedAt: string;
  /** Whether this was user-submitted */
  userSubmitted: boolean;
}

/**
 * Property FMV (Fair Market Value) from crowd estimates
 */
export interface PropertyFMV {
  /** Weighted crowd-estimated value */
  value: number;
  /** Confidence level based on number and quality of guesses */
  confidence: 'low' | 'medium' | 'high';
  /** Total number of guesses */
  guessCount: number;
  /** Distribution statistics */
  distribution: {
    min: number;
    max: number;
    median: number;
    /** 25th percentile */
    p25: number;
    /** 75th percentile */
    p75: number;
  };
  /** Comparison to asking price (if listing exists) */
  vsAskingPrice?: {
    difference: number;
    percentageDifference: number;
  };
}

/**
 * Property activity metrics
 */
export interface PropertyActivity {
  /** Total views */
  viewCount: number;
  /** Unique viewers */
  uniqueViewerCount: number;
  /** Total comments */
  commentCount: number;
  /** Total price guesses */
  guessCount: number;
  /** Total saves/follows */
  saveCount: number;
  /** Total likes/upvotes */
  likeCount: number;
  /** Interest velocity indicator */
  trend: 'rising' | 'stable' | 'falling';
  /** Last activity timestamp */
  lastActivityAt?: string;
}

/**
 * Property photo
 */
export interface PropertyPhoto {
  id: string;
  url: string;
  source: 'listing' | 'user' | 'streetview';
  /** User who submitted (if user-submitted) */
  submittedBy?: string;
  createdAt: string;
}

/**
 * Legacy single-property map shape retained for non-grouped consumers.
 * Density-aware runtime code should prefer PropertyNodeGroup.
 */
export interface MapProperty {
  id: string;
  coordinates: Coordinates;
  /** Whether this is a ghost node (no listing and activity score is zero) */
  isGhost: boolean;
  /** Activity level for styling */
  activityLevel: ActivityLevel;
  /** Whether to show photo preview */
  showPhotoPreview: boolean;
  /** Photo URL for preview (when shown) */
  photoUrl?: string;
  /** Quick stats for preview */
  askingPrice?: number;
  fmvValue?: number;
}

/**
 * Legacy cluster shape retained for older consumers.
 * Density-aware runtime code should prefer PropertyNodeGroup.
 */
export interface PropertyCluster {
  id: string;
  coordinates: Coordinates;
  /** Number of properties in cluster */
  count: number;
  /** Average activity level */
  averageActivityLevel: ActivityLevel;
  /** Bounding box of cluster */
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

/**
 * Bounding box for a grouped map node.
 */
export interface PropertyGroupBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Canonical grouped map node model shared across tile features and nearby JSON.
 */
export interface PropertyNodeGroup {
  nodeClass: PropertyNodeClass;
  groupKind: PropertyGroupKind;
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  bbox: PropertyGroupBounds | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  streetName: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  hasActiveListing: boolean | null;
  marketState: MapMarketState | null;
}

/**
 * Nearby grouped node response adds the tap distance to the canonical grouped model.
 */
export interface NearbyPropertyGroup extends PropertyNodeGroup {
  distanceMeters: number;
}

/**
 * Canonical filter categories for map state.
 */
export type MapFilterCategory = 'price' | 'marketState' | 'activity';

/**
 * Exclusive market-state taxonomy for map filtering.
 */
export type MapMarketState =
  | 'for-sale'
  | 'for-rent'
  | 'sold'
  | 'rented'
  | 'not-listed';

/**
 * Shared applied map-filter state.
 */
export interface MapFilters {
  salePriceFrom: number | null;
  salePriceTo: number | null;
  rentPriceFrom: number | null;
  rentPriceTo: number | null;
  marketState: MapMarketState[];
  activity: MapActivityFilter;
}

/**
 * Sale-side facts used to derive the canonical sale effective price.
 */
export interface SaleEffectivePriceInput {
  activeSaleAskingPrice?: number | null;
  lastSoldPrice?: number | null;
  canonicalFmv?: number | null;
  officialValuation?: number | null;
}

/**
 * Rent-side facts used to derive the canonical rent effective price.
 */
export interface RentEffectivePriceInput {
  activeRentAskingPrice?: number | null;
  lastRentedPrice?: number | null;
}
