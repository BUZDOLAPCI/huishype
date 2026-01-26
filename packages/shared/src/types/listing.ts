/**
 * Listing-related types for HuisHype
 * Listings are properties that are currently for sale/rent
 */

/**
 * Listing source platform
 */
export type ListingSource = 'funda' | 'pararius' | 'other';

/**
 * Listing status
 */
export type ListingStatus =
  | 'active'
  | 'under_offer'
  | 'sold'
  | 'withdrawn'
  | 'expired';

/**
 * Full listing information
 */
export interface Listing {
  id: string;
  /** Reference to the property */
  propertyId: string;
  /** Original listing URL */
  sourceUrl: string;
  /** Platform name */
  sourceName: ListingSource;
  /** Current asking price */
  askingPrice: number;
  /** Original asking price (if changed) */
  originalAskingPrice?: number;
  /** Price history */
  priceHistory: PriceChange[];
  /** Listing status */
  status: ListingStatus;
  /** Thumbnail image URL (from Open Graph) */
  thumbnailUrl?: string;
  /** Listing title (from Open Graph) */
  title?: string;
  /** Listing description snippet */
  description?: string;
  /** When this listing was first discovered */
  discoveredAt: string;
  /** When this listing was last verified/updated */
  lastVerifiedAt: string;
  /** Whether this listing was user-submitted */
  userSubmitted: boolean;
  /** User who submitted (if user-submitted) */
  submittedByUserId?: string;
  /** Final sale price (when sold) */
  salePrice?: number;
  /** Sale date (when sold) */
  soldAt?: string;
}

/**
 * Price change record
 */
export interface PriceChange {
  oldPrice: number;
  newPrice: number;
  changedAt: string;
}

/**
 * Listing summary for feeds and lists
 */
export interface ListingSummary {
  id: string;
  propertyId: string;
  address: string;
  city: string;
  postalCode: string;
  askingPrice: number;
  thumbnailUrl?: string;
  sourceName: ListingSource;
  sourceUrl: string;
  status: ListingStatus;
  /** FMV comparison */
  fmvValue?: number;
  fmvDifference?: number;
  /** Activity metrics */
  commentCount: number;
  guessCount: number;
  likeCount: number;
  activityLevel: import('./property').ActivityLevel;
}

/**
 * User-submitted listing request
 */
export interface SubmitListingRequest {
  /** URL to the listing (funda, pararius, etc.) */
  url: string;
}

/**
 * Response after submitting a listing
 */
export interface SubmitListingResponse {
  /** Whether a new listing was created or existing one returned */
  created: boolean;
  /** The listing (new or existing) */
  listing: Listing;
  /** The associated property */
  propertyId: string;
}

/**
 * Open Graph metadata extracted from listing URL
 */
export interface ListingOpenGraphData {
  title?: string;
  description?: string;
  imageUrl?: string;
  url: string;
}
