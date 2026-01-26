/**
 * Reaction-related types for HuisHype
 */

/**
 * Reaction types available on properties
 */
export type ReactionType =
  | 'like' // General interest/upvote
  | 'save' // Save to favorites
  | 'share'; // Share action (tracked)

/**
 * Property reaction
 */
export interface Reaction {
  id: string;
  propertyId: string;
  userId: string;
  type: ReactionType;
  createdAt: string;
}

/**
 * Property reaction counts
 */
export interface ReactionCounts {
  likes: number;
  saves: number;
  shares: number;
}

/**
 * User's reactions on a property
 */
export interface UserPropertyReactions {
  hasLiked: boolean;
  hasSaved: boolean;
  likedAt?: string;
  savedAt?: string;
}

/**
 * Toggle reaction request
 */
export interface ToggleReactionRequest {
  propertyId: string;
  type: ReactionType;
}

/**
 * Toggle reaction response
 */
export interface ToggleReactionResponse {
  /** Whether the reaction is now active */
  isActive: boolean;
  /** Updated counts */
  counts: ReactionCounts;
}

/**
 * Comment like (simpler than property reactions)
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
