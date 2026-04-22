/**
 * Type exports for @huishype/shared
 */

// User types
export type {
  User,
  UserProfile,
  UserBadge,
  UserSession,
  UserSummary,
  KarmaRank,
  InternalKarmaMetrics,
  FollowRelationship,
  KarmaRankSummary,
  PublicUserProfile,
  MyUserProfile,
  FollowListUser,
  FollowListResponse,
  FollowRelationshipResponse,
  UserSearchItem,
  SearchUsersRequest,
  SearchUsersResponse,
} from './user.js';

// Property types
export type {
  Property,
  PropertyDetail,
  PropertySummary,
  PropertyListing,
  PropertyFMV,
  PropertyActivity,
  PropertyPhoto,
  PropertyType,
  Coordinates,
  ActivityLevel,
  MapProperty,
  PropertyCluster,
  PropertyNodeClass,
  PropertyGroupKind,
  PropertyGroupBounds,
  PropertyNodeGroup,
  NearbyPropertyGroup,
  MapActivityFilter,
  MapActivityTimeFilter,
  MapFilterCategory,
  MapMarketState,
  PropertyMarketFilters,
  FollowingPropertyFilters,
  MapFilters,
  SaleEffectivePriceInput,
  RentEffectivePriceInput,
} from './property.js';

// Listing types
export type {
  Listing,
  ListingSummary,
  ListingSource,
  ListingStatus,
  PriceChange,
  ListingOpenGraphData,
  SubmitListingRequest,
  SubmitListingResponse,
} from './listing.js';

// Guess types
export type {
  PriceGuess,
  PriceGuessWithUser,
  PriceGuessWithProperty,
  GuessResult,
  FMV,
  FMVDistribution,
  ConsensusAlignment,
  SubmitGuessRequest,
  SubmitGuessResponse,
  UpdateGuessRequest,
  GuessValidationError,
  UserGuessHistory,
} from './guess.js';

// Comment types
export type {
  Comment,
  CommentWithReplies,
  CommentThread,
  CreateCommentRequest,
  UpdateCommentRequest,
  CommentSortOption,
  GetCommentsParams,
  CommentNotification,
} from './comment.js';

// Like types (renamed from Reaction — DB table is still `reactions`, API contract is likes-only)
export type {
  LikeStatus,
  Reaction,
  ReactionType,
  ReactionCounts,
  UserPropertyReactions,
  CommentLike,
  ToggleCommentLikeResponse,
} from './reaction.js';

// Notification types
export type {
  NotificationEventType,
  NotificationActor,
  NotificationItem,
  NotificationsResponse,
  UnreadCountResponse,
} from './notification.js';

// Achievement types
export type {
  AchievementCategory,
  AchievementDefinition,
  EarnedAchievement,
  AchievementsResponse,
} from './achievement.js';

// Activity types
export type {
  ActivityEventType,
  PublicActivityEventType,
  ActivityActor,
  ActivityProperty,
  ActivityItem,
  ActivityResponse,
  PublicActivityResponse,
} from './activity.js';

// Leaderboard types
export type {
  LeaderboardPeriod,
  LeaderboardEntry,
  LeaderboardResponse,
} from './leaderboard.js';

// Geocoding types
export type { GeocodeSuggestion } from './geocoding.js';

// API types
export type {
  ApiError,
  PaginatedResponse,
  CursorPaginatedResponse,
  // Auth
  AuthProviderType,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshRequest,
  AuthRefreshResponse,
  AuthLogoutRequest,
  AuthMeResponse,
  // User
  GetUserProfileResponse,
  GetMyProfileResponse,
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
  GetUserGuessHistoryResponse,
  GetFollowListRequest,
  GetFollowersResponse,
  GetFollowingResponse,
  FollowUserResponse,
  UnfollowUserResponse,
  // Property
  PropertyResolveRequest,
  ResolvedProperty,
  PropertyResolveResponse,
  LatestListingStatus,
  PropertyContractBase,
  PropertyFmvResponse,
  GetPropertyRequest,
  GetPropertyResponse,
  // Listing
  GetListingsRequest,
  GetListingsResponse,
  // Guess
  GetPropertyGuessesRequest,
  GetPropertyGuessesResponse,
  // Comment
  GetCommentsRequest,
  GetCommentsResponse,
  CreateCommentResponse,
  UpdateCommentResponse,
  DeleteCommentResponse,
  LikeCommentResponse,
  // Reaction / Likes
  // Feed
  FeedTab,
  PropertyFeedFilter,
  FeedItem,
  GetFeedRequest,
  GetFeedResponse,
  // Saved
  GetSavedPropertiesRequest,
  SavedProperty,
  GetSavedPropertiesResponse,
  PropertyTileJson,
  FollowingPropertyTileRequest,
  GetFollowingPropertyTilesRequest,
  GetFollowingPropertyTilesResponse,
  GetFollowingNearbyPropertyRequest,
  GetFollowingNearbyPropertyResponse,
  // Notification
  GetNotificationsResponse,
  GetUnreadCountResponse,
  MarkReadResponse,
  MarkAllReadResponse,
  RegisterPushTokenRequest,
  // Leaderboard
  GetLeaderboardResponse,
  // Activity
  GetActivityRequest,
  GetUserActivityRequest,
  GetActivityResponse,
  GetUserActivityResponse,
  // Achievement
  GetAchievementsResponse,
  // Email Auth
  EmailAuthRequestBody,
  EmailAuthRequestResponse,
  EmailAuthVerifyBody,
} from './api.js';
