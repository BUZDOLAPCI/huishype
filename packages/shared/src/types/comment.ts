/**
 * Comment-related types for HuisHype
 * Comments follow a TikTok/Instagram-style short-form pattern
 */

import type { UserSummary } from './user';

/**
 * Comment on a property
 */
export interface Comment {
  id: string;
  /** Reference to the property */
  propertyId: string;
  /** Reference to the user who posted */
  userId: string;
  /** User information for display */
  user: UserSummary;
  /** Parent comment ID (for replies - max 1 level deep) */
  parentId?: string;
  /** Mentioned user (for reply chains) */
  mentionedUser?: Pick<UserSummary, 'id' | 'username'>;
  /** Comment text content */
  content: string;
  /** Number of likes */
  likes: number;
  /** Whether current user has liked this comment */
  isLikedByCurrentUser?: boolean;
  /** When this comment was posted */
  createdAt: string;
  /** When this comment was edited (if edited) */
  editedAt?: string;
  /** Whether this comment was edited */
  isEdited: boolean;
  /** Number of replies (only for parent comments) */
  replyCount?: number;
}

/**
 * Comment with its replies loaded
 */
export interface CommentWithReplies extends Comment {
  replies: Comment[];
}

/**
 * Comment thread for a property
 */
export interface CommentThread {
  /** Total comment count (including replies) */
  totalCount: number;
  /** Parent comments (sorted by popularity then recency like TikTok) */
  comments: CommentWithReplies[];
  /** Whether there are more comments to load */
  hasMore: boolean;
  /** Cursor for pagination */
  nextCursor?: string;
}

/**
 * Create comment request
 */
export interface CreateCommentRequest {
  propertyId: string;
  content: string;
  /** Parent comment ID if this is a reply */
  parentId?: string;
}

/**
 * Update comment request
 */
export interface UpdateCommentRequest {
  content: string;
}

/**
 * Comment sort options
 */
export type CommentSortOption =
  | 'popular_recent' // Default: newer popular comments on top (TikTok-style)
  | 'newest'
  | 'oldest'
  | 'most_liked';

/**
 * Get comments request parameters
 */
export interface GetCommentsParams {
  propertyId: string;
  sort?: CommentSortOption;
  cursor?: string;
  limit?: number;
}

/**
 * Comment notification data
 */
export interface CommentNotification {
  type: 'reply' | 'mention' | 'like';
  commentId: string;
  propertyId: string;
  fromUser: UserSummary;
  content: string;
  createdAt: string;
}
