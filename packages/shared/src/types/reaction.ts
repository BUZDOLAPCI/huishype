/**
 * Like-related types for HuisHype
 *
 * DB schema decision: The database table is named `reactions` with a 4-type enum
 * (like, love, wow, angry), but only `like` is used. The API contract is likes-only.
 * This file documents the API-layer types, not DB internals.
 */

/**
 * Like status and count for a property or comment
 */
export interface LikeStatus {
  liked: boolean;
  likeCount: number;
}

/**
 * Comment like (simpler than property likes)
 */
export interface CommentLike {
  commentId: string;
  userId: string;
  createdAt: string;
}

/**
 * Toggle comment like response
 */
export interface ToggleCommentLikeResponse {
  isLiked: boolean;
  likeCount: number;
}

// Legacy aliases kept for backward compat — prefer LikeStatus
/** @deprecated Use LikeStatus */
export type ReactionType = 'like';

/** @deprecated Use LikeStatus */
export interface ReactionCounts {
  likes: number;
}

/** @deprecated Use LikeStatus */
export interface UserPropertyReactions {
  hasLiked: boolean;
  likedAt?: string;
}

/** @deprecated — DB-level type, not part of API contract */
export interface Reaction {
  id: string;
  propertyId: string;
  userId: string;
  type: ReactionType;
  createdAt: string;
}
