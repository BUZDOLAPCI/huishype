/**
 * Listing-related types for HuisHype
 * Listings are properties that are currently for sale/rent
 */

/**
 * Listing source platform
 */
export type ListingSource = string;

/**
 * Listing status
 */
export type ListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';

export type ListingValidationState = 'valid' | 'invalid' | 'provisional';

export type ListingMatchState = 'matched' | 'mismatch' | 'unverified' | 'unsupported';

export type ListingPreviewWatchState = 'not_required' | 'will_enqueue' | 'unsupported';

export type ListingWatchState =
  | ListingPreviewWatchState
  | 'pending'
  | 'queued'
  | 'fetching'
  | 'matched'
  | 'not_found'
  | 'blocked'
  | 'invalid'
  | 'parser_error'
  | 'retryable_error';

export type ListingVerificationState =
  | 'provisional'
  | 'validated'
  | 'invalid'
  | 'validation_pending'
  | 'validation_blocked'
  | 'validation_failed';

export type ListingOriginSummary = 'user' | 'mirror' | 'user_and_mirror';

export type ListingReasonCode =
  | 'source_identity_match'
  | 'address_match'
  | 'address_mismatch'
  | 'source_not_supported'
  | 'source_not_found'
  | 'mirror_unavailable'
  | 'parser_error'
  | 'og_unavailable'
  | 'validation_pending';

export type ListingPriceType = 'sale' | 'rent' | 'unknown';

/**
 * Full listing information
 */
export interface Listing {
  id: string;
  /** Reference to the property */
  propertyId: string;
  /** Original listing URL */
  sourceUrl: string;
  /** Source-owned canonical listing URL, when resolved */
  canonicalUrl?: string | null;
  /** User-facing URL to open externally */
  displayUrl?: string | null;
  /** Platform name */
  sourceName: ListingSource;
  /** Source-owned listing identity, when resolved */
  sourceListingId?: string | null;
  /** Source identity kind, e.g. tiny_id, global_id, url_path */
  sourceListingIdKind?: string | null;
  /** Current asking price */
  askingPrice: number;
  /** Price type reported by the source */
  priceType?: ListingPriceType | string | null;
  /** Price currency */
  currency?: string | null;
  /** Original asking price (if changed) */
  originalAskingPrice?: number;
  /** Price history */
  priceHistory: PriceChange[];
  /** Listing status */
  status: ListingStatus;
  /** Source validation state for this listing */
  validationState?: ListingValidationState | null;
  /** Property match state reported by source validation */
  matchState?: ListingMatchState | null;
  /** Durable mirror watch state, if a user submission is pending validation */
  watchState?: ListingWatchState | null;
  /** Canonical verification state used by read surfaces */
  verificationState?: ListingVerificationState | null;
  /** Provenance summary for the canonical listing */
  originSummary?: ListingOriginSummary | null;
  /** Validation or reconciliation reason code */
  reasonCode?: ListingReasonCode | string | null;
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
  activityLevel: import('./property.js').ActivityLevel;
}

/**
 * User-submitted listing request
 */
export interface SubmitListingRequest {
  /** URL to the listing (funda, pararius, etc.) */
  url: string;
  /** Local property this listing belongs to */
  propertyId: string;
  /** Extracted Open Graph title, if available */
  ogTitle?: string;
  /** Extracted Open Graph thumbnail URL, if available */
  thumbnailUrl?: string;
}

/**
 * Response after submitting a listing
 */
export interface SubmitListingResponse {
  id: string;
  propertyId: string;
  sourceUrl: string;
  sourceName: ListingSource;
  status: ListingStatus;
  createdAt: string;
}

export interface PreviewListingRequest {
  url: string;
  propertyId: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  askingPrice?: number;
  priceType?: ListingPriceType;
  currency?: string;
}

export interface ListingPreviewAddress {
  street?: string | null;
  postalCode?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  city?: string | null;
}

export interface ListingPreviewResponse {
  sourceName: ListingSource;
  rawUrl: string;
  canonicalUrl: string | null;
  sourceListingId: string | null;
  sourceListingIdKind: string | null;
  validationState: ListingValidationState;
  matchState: ListingMatchState;
  watchState: ListingPreviewWatchState;
  reasonCode: ListingReasonCode | string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  askingPrice: number | null;
  priceType: ListingPriceType;
  currency: string | null;
  address: string | ListingPreviewAddress | null;
  submittedPropertyId: string;
  matchedPropertyId: string | null;
}

export interface ListingSubmitResult extends SubmitListingResponse {
  canonicalListingId: string;
  canonicalUrl: string | null;
  displayUrl: string | null;
  sourceListingId: string | null;
  sourceListingIdKind: string | null;
  validationState: ListingValidationState;
  matchState: ListingMatchState;
  watchState: ListingWatchState | null;
  verificationState: ListingVerificationState;
  reasonCode: ListingReasonCode | string;
}

export interface ListingReadItem {
  id: string;
  propertyId: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  displayUrl: string | null;
  sourceName: ListingSource;
  sourceListingId: string | null;
  sourceListingIdKind: string | null;
  askingPrice: number | null;
  priceType: ListingPriceType | string | null;
  currency: string | null;
  thumbnailUrl: string | null;
  ogTitle: string | null;
  livingAreaM2: number | null;
  numRooms: number | null;
  energyLabel: string | null;
  status: ListingStatus;
  validationState: ListingValidationState | null;
  matchState: ListingMatchState | null;
  watchState: ListingWatchState | null;
  verificationState: ListingVerificationState;
  originSummary: ListingOriginSummary;
  reasonCode: ListingReasonCode | string | null;
  createdAt: string;
}

export interface PropertyListingsResponse {
  data: ListingReadItem[];
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
