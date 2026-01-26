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
} from './user';

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
} from './property';

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
} from './listing';

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
} from './guess';

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
} from './comment';

// Reaction types
export type {
  Reaction,
  ReactionType,
  ReactionCounts,
  UserPropertyReactions,
  ToggleReactionRequest,
  ToggleReactionResponse,
  CommentLike,
  ToggleCommentLikeResponse,
} from './reaction';

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
  // User
  GetUserProfileResponse,
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
  GetUserGuessHistoryResponse,
  // Property
  GetPropertyRequest,
  GetPropertyResponse,
  SearchPropertiesRequest,
  SearchPropertiesResponse,
  GetMapPropertiesRequest,
  GetMapPropertiesResponse,
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
  // Reaction
  // Feed
  FeedType,
  GetFeedRequest,
  GetFeedResponse,
  // Saved
  GetSavedPropertiesRequest,
  GetSavedPropertiesResponse,
} from './api';
