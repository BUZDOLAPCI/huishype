/**
 * Property-related types for HuisHype
 * Properties represent addresses from BAG (Basisregistratie Adressen en Gebouwen)
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
 * Core property information from BAG data
 */
export interface Property {
  id: string;
  /** BAG identificatie (official Dutch government identifier) */
  bagIdentificatie: string;
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
  /** Postal code (Dutch format: 1234 AB) */
  postalCode: string;
  /** Geographic coordinates */
  coordinates: Coordinates;
  /** Year of construction from BAG */
  bouwjaar?: number;
  /** Living area in square meters from BAG */
  oppervlakte?: number;
  /** Official WOZ value (government property valuation) */
  wozValue?: number;
  /** Year of the WOZ valuation */
  wozYear?: number;
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
  sourceName: 'funda' | 'pararius' | 'other';
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
 * Property for map display (clustered or individual)
 */
export interface MapProperty {
  id: string;
  coordinates: Coordinates;
  /** Whether this is a ghost node (listing exists but no social activity) */
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
 * Clustered properties for map at low zoom levels
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
