/**
 * API request/response types for HuisHype
 * These types define the contract between frontend and backend
 */

import type {
  PropertyDetail,
  PropertySummary,
  MapMarketState,
  PropertyMarketFilters,
} from './property.js';
import type { ListingSummary, ListingStatus } from './listing.js';
import type {
  User,
  UserProfile,
  UserSession,
  PublicUserProfile,
  MyUserProfile,
  FollowListResponse,
  FollowRelationshipResponse,
} from './user.js';
import type { PriceGuess, FMV, UserGuessHistory } from './guess.js';
import type { CommentThread, Comment } from './comment.js';
import type { ReactionCounts } from './reaction.js';
import type { NotificationsResponse, UnreadCountResponse } from './notification.js';
import type { AchievementsResponse } from './achievement.js';
import type { ActivityResponse, PublicActivityResponse } from './activity.js';
import type { LeaderboardResponse } from './leaderboard.js';

// Re-export imported types to suppress unused warnings when they're part of the API contract
export type { PropertyDetail, PropertySummary };
export type { ListingSummary };
export type {
  User,
  UserProfile,
  UserSession,
  PublicUserProfile,
  MyUserProfile,
  FollowListResponse,
  FollowRelationshipResponse,
};
export type { PriceGuess, FMV, UserGuessHistory };
export type { CommentThread, Comment };
export type { ReactionCounts };
export type { NotificationsResponse, UnreadCountResponse };
export type { AchievementsResponse };
export type { ActivityResponse, PublicActivityResponse };
export type { LeaderboardResponse };

// ============================================
// Common API Types
// ============================================

/**
 * Standard API error response
 */
export interface ApiError {
  error: string;
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

export interface AuthMeResponse {
  user: User & {
    email: string;
    profilePhotoUrl: string | null;
  };
}

// ============================================
// User API Types
// ============================================

export type GetUserProfileResponse = PublicUserProfile;
export type GetMyProfileResponse = MyUserProfile;

export interface UpdateUserProfileRequest {
  displayName?: string;
  profilePhotoUrl?: string;
  homeCountry?: string | null;
}

export interface UpdateUserProfileResponse {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
  homeCountry: string | null;
  lastNameChangeAt: string | null;
}

export interface GetUserGuessHistoryResponse {
  history: UserGuessHistory;
}

export interface GetFollowListRequest {
  limit?: number;
  offset?: number;
}

export type GetFollowersResponse = FollowListResponse;
export type GetFollowingResponse = FollowListResponse;
export type FollowUserResponse = FollowRelationshipResponse;
export type UnfollowUserResponse = FollowRelationshipResponse;

// ============================================
// Property API Types
// ============================================

/**
 * Response for resolving an address to a local property.
 * Used by the search feature: geocoder provides fuzzy address matching,
 * then the backend resolves the address to our local property.
 */
export interface PropertyResolveRequest {
  postalCode: string;
  houseNumber: number;
  houseNumberAddition?: string;
  countryCode?: string;
  street?: string;
  city?: string;
}

export interface ResolvedProperty {
  id: string;
  countryCode: string;
  address: string;
  postalCode: string;
  city: string;
  coordinates: { lon: number; lat: number } | null;
  hasActiveListing: boolean;
  marketState: MapMarketState;
  officialValuation: number | null;
}

export type PropertyResolveResponse = ResolvedProperty | null;

export type LatestListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn' | null;

export interface PropertyContractBase {
  id: string;
  nationalId: string | null;
  countryCode: string;
  region: string | null;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: 'active' | 'inactive' | 'demolished';
  officialValuation: number | null;
  createdAt: string;
  updatedAt: string;
  hasListing: boolean;
  hasActiveListing: boolean;
  marketState: MapMarketState;
  latestListingStatus: LatestListingStatus;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  socialScore: number;
  recentSocialScore: number;
  lastSocialAt: string | null;
  topLevelCommentCount: number;
  replyCount: number;
  propertyLikeCount: number;
  commentLikeCount: number;
  guessCount: number;
  viewCount: number;
  uniqueViewerCount: number;
  recentTopLevelCommentCount: number;
  recentReplyCount: number;
  recentPropertyLikeCount: number;
  recentCommentLikeCount: number;
  recentGuessCount: number;
  recentViewCount: number;
  recentUniqueViewerCount: number;
}

export interface PropertyFmvResponse {
  fmv: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    min: number;
    max: number;
  } | null;
  officialValuation: number | null;
  askingPrice: number | null;
  divergence: number | null;
}

export interface GetPropertyRequest {
  id: string;
}

export interface GetPropertyResponse extends PropertyContractBase {
  isLiked: boolean;
  isSaved: boolean;
  commentCount: number;
  likeCount: number;
  uniqueViewers: number;
  fmv: PropertyFmvResponse;
}

// ============================================
// Listing API Types
// ============================================

export interface SubmitListingRequest {
  url: string;
  propertyId: string;
  ogTitle?: string;
  thumbnailUrl?: string;
}

export interface SubmitListingResponse {
  id: string;
  propertyId: string;
  sourceUrl: string;
  sourceName: string;
  status: ListingStatus;
  createdAt: string;
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
// Feed API Types
// ============================================

// Feed tabs shown in the app UI.
// Property feed tabs are derived from the canonical /feed contract.
export type FeedTab = PropertyFeedFilter | 'recent-activity' | 'following';

// Filters accepted by the property-only /feed endpoint.
export type PropertyFeedFilter = 'trending' | 'latest';

export interface FeedItem {
  id: string;
  address: string;
  city: string;
  zipCode: string;
  countryCode: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  askingPrice: number | null;
  fmv: number | null;
  officialValuation: number | null;
  thumbnailUrl: string | null;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  viewCount: number;
  activityLevel: 'hot' | 'warm' | 'cold';
  lastActivityAt: string;
  hasListing: boolean;
}

export interface GetFeedRequest {
  filter?: PropertyFeedFilter;
  page?: number;
  limit?: number;
  lat?: number;
  lon?: number;
  country?: string;
}

export interface GetFeedResponse {
  items: FeedItem[];
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

// ============================================
// Saved Properties API Types
// ============================================

export interface GetSavedPropertiesRequest {
  limit?: number;
  offset?: number;
}

export interface SavedProperty {
  id: string;
  nationalId: string | null;
  countryCode: string;
  region: string | null;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: 'active' | 'inactive' | 'demolished';
  officialValuation: number | null;
  createdAt: string;
  updatedAt: string;
  hasListing: boolean;
  hasActiveListing: boolean;
  marketState: MapMarketState;
  latestListingStatus: LatestListingStatus;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  socialScore: number;
  recentSocialScore: number;
  lastSocialAt: string | null;
  topLevelCommentCount: number;
  replyCount: number;
  propertyLikeCount: number;
  commentLikeCount: number;
  guessCount: number;
  viewCount: number;
  uniqueViewerCount: number;
  recentTopLevelCommentCount: number;
  recentReplyCount: number;
  recentPropertyLikeCount: number;
  recentCommentLikeCount: number;
  recentGuessCount: number;
  recentViewCount: number;
  recentUniqueViewerCount: number;
  savedAt: string;
  isSaved: true;
}

export interface GetSavedPropertiesResponse {
  data: SavedProperty[];
  total: number;
  hasMore: boolean;
}

export interface PropertyTileJson {
  tilejson: string;
  name: string;
  description: string;
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
}

export interface FollowingPropertyTileRequest
  extends Omit<PropertyMarketFilters, 'marketState'> {
  marketState?: MapMarketState | MapMarketState[];
}

export type GetFollowingPropertyTilesRequest = FollowingPropertyTileRequest;

export type GetFollowingPropertyTilesResponse = PropertyTileJson;

export interface GetFollowingNearbyPropertyRequest extends FollowingPropertyTileRequest {
  lon: number;
  lat: number;
  zoom?: number;
}

export type FollowingNearbyPropertyGroupBase = {
  nodeClass: 'active' | 'ghost';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
};

export type FollowingNearbySinglePropertyResponse = {
  nodeClass: 'active' | 'ghost';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  groupKind: 'single';
  address: string;
  city: string;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean;
  marketState: MapMarketState;
};

export type FollowingNearbyClusterPropertyResponse = {
  nodeClass: 'active' | 'ghost';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  groupKind: 'cluster';
};

export type FollowingNearbyPropertyResponse =
  | FollowingNearbySinglePropertyResponse
  | FollowingNearbyClusterPropertyResponse
  | null;

export type GetFollowingNearbyPropertyResponse = FollowingNearbyPropertyResponse;

// ============================================
// Notification API Types
// ============================================

export type GetNotificationsResponse = NotificationsResponse;
export type GetUnreadCountResponse = UnreadCountResponse;

export interface MarkReadResponse {
  success: boolean;
}

export interface MarkAllReadResponse {
  markedCount: number;
}

export interface RegisterPushTokenRequest {
  token: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
}

// ============================================
// Leaderboard API Types
// ============================================

export type GetLeaderboardResponse = LeaderboardResponse;

// ============================================
// Activity API Types
// ============================================

export interface GetActivityRequest {
  scope?: 'public' | 'following';
  limit?: number;
  offset?: number;
}

export interface GetUserActivityRequest {
  limit?: number;
  offset?: number;
}

export type GetActivityResponse = PublicActivityResponse;
export type GetUserActivityResponse = ActivityResponse;

// ============================================
// Achievement API Types
// ============================================

export type GetAchievementsResponse = AchievementsResponse;

// ============================================
// Email Auth API Types
// ============================================

export interface EmailAuthRequestBody {
  email: string;
}

export interface EmailAuthRequestResponse {
  message: string;
  token?: string;
}

export interface EmailAuthVerifyBody {
  token: string;
}
