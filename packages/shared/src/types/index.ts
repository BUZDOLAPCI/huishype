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
  ActivityActor,
  ActivityProperty,
  ActivityItem,
  ActivityResponse,
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
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
  GetUserGuessHistoryResponse,
  // Property
  PropertyResolveRequest,
  PropertyResolveResponse,
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
  // Notification
  GetNotificationsResponse,
  GetUnreadCountResponse,
  MarkReadResponse,
  MarkAllReadResponse,
  RegisterPushTokenRequest,
  // Leaderboard
  GetLeaderboardResponse,
  // Activity
  GetActivityResponse,
  GetUserActivityResponse,
  // Achievement
  GetAchievementsResponse,
  // Email Auth
  EmailAuthRequestBody,
  EmailAuthRequestResponse,
  EmailAuthVerifyBody,
} from './api.js';
