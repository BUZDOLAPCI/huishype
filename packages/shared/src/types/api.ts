/**
 * API request/response types for HuisHype
 * These types define the contract between frontend and backend
 */

import type { PropertyDetail, PropertySummary, MapProperty, PropertyCluster } from './property';
import type { Listing, ListingSummary } from './listing';
import type { User, UserProfile, UserSession } from './user';
import type { PriceGuess, FMV, UserGuessHistory } from './guess';
import type { CommentThread, Comment } from './comment';
import type { ReactionCounts, UserPropertyReactions } from './reaction';

// Re-export imported types to suppress unused warnings when they're part of the API contract
export type { PropertyDetail, PropertySummary, MapProperty, PropertyCluster };
export type { Listing, ListingSummary };
export type { User, UserProfile, UserSession };
export type { PriceGuess, FMV, UserGuessHistory };
export type { CommentThread, Comment };
export type { ReactionCounts, UserPropertyReactions };

// ============================================
// Common API Types
// ============================================

/**
 * Standard API error response
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Cursor-based pagination response
 */
export interface CursorPaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
}

// ============================================
// Auth API Types
// ============================================

export interface AuthProviderType {
  provider: 'google' | 'apple';
}

export interface AuthLoginRequest {
  provider: 'google' | 'apple';
  idToken: string;
}

export interface AuthLoginResponse {
  session: UserSession;
  isNewUser: boolean;
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface AuthRefreshResponse {
  accessToken: string;
  expiresAt: string;
}

export interface AuthLogoutRequest {
  refreshToken?: string;
}

// ============================================
// User API Types
// ============================================

export interface GetUserProfileResponse {
  profile: UserProfile;
}

export interface UpdateUserProfileRequest {
  displayName?: string;
}

export interface UpdateUserProfileResponse {
  user: User;
}

export interface GetUserGuessHistoryResponse {
  history: UserGuessHistory;
}

// ============================================
// Property API Types
// ============================================

export interface GetPropertyRequest {
  id: string;
}

export interface GetPropertyResponse {
  property: PropertyDetail;
  userReactions?: UserPropertyReactions;
  userGuess?: PriceGuess;
}

export interface SearchPropertiesRequest {
  query: string;
  city?: string;
  postalCode?: string;
  limit?: number;
}

export interface SearchPropertiesResponse {
  results: PropertySummary[];
}

export interface GetMapPropertiesRequest {
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  zoom: number;
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    minSize?: number;
    maxSize?: number;
    activityLevel?: ('cold' | 'warm' | 'hot')[];
    hasListing?: boolean;
  };
}

export interface GetMapPropertiesResponse {
  /** Individual properties (at higher zoom) */
  properties: MapProperty[];
  /** Clustered properties (at lower zoom) */
  clusters: PropertyCluster[];
}

// ============================================
// Listing API Types
// ============================================

export interface SubmitListingRequest {
  url: string;
}

export interface SubmitListingResponse {
  created: boolean;
  listing: Listing;
  propertyId: string;
}

export interface GetListingsRequest {
  page?: number;
  pageSize?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'most_active';
  city?: string;
  minPrice?: number;
  maxPrice?: number;
}

export type GetListingsResponse = PaginatedResponse<ListingSummary>;

// ============================================
// Guess API Types
// ============================================

export interface SubmitGuessRequest {
  propertyId: string;
  guessedPrice: number;
}

export interface UpdateGuessRequest {
  guessedPrice: number;
}

export interface GetPropertyGuessesRequest {
  propertyId: string;
  limit?: number;
  cursor?: string;
}

export interface GetPropertyGuessesResponse extends CursorPaginatedResponse<PriceGuess> {
  fmv: FMV;
}

// ============================================
// Comment API Types
// ============================================

export interface GetCommentsRequest {
  propertyId: string;
  sort?: 'popular_recent' | 'newest' | 'oldest' | 'most_liked';
  cursor?: string;
  limit?: number;
}

export interface GetCommentsResponse {
  thread: CommentThread;
}

export interface CreateCommentRequest {
  propertyId: string;
  content: string;
  parentId?: string;
}

export interface CreateCommentResponse {
  comment: Comment;
}

export interface UpdateCommentRequest {
  content: string;
}

export interface UpdateCommentResponse {
  comment: Comment;
}

export interface DeleteCommentResponse {
  success: boolean;
}

export interface LikeCommentResponse {
  isLiked: boolean;
  likeCount: number;
}

// ============================================
// Reaction API Types
// ============================================

export interface ToggleReactionRequest {
  propertyId: string;
  type: 'like' | 'save';
}

export interface ToggleReactionResponse {
  isActive: boolean;
  counts: ReactionCounts;
}

// ============================================
// Feed API Types
// ============================================

export type FeedType =
  | 'trending'       // Most active recently
  | 'new'            // Newly listed
  | 'controversial'  // High price variance
  | 'overpriced'     // FMV significantly below asking
  | 'underpriced';   // FMV significantly above asking

export interface GetFeedRequest {
  type: FeedType;
  page?: number;
  pageSize?: number;
  city?: string;
}

export interface GetFeedResponse extends PaginatedResponse<PropertySummary> {
  feedType: FeedType;
}

// ============================================
// Saved Properties API Types
// ============================================

export interface GetSavedPropertiesRequest {
  page?: number;
  pageSize?: number;
}

export type GetSavedPropertiesResponse = PaginatedResponse<PropertySummary>;
