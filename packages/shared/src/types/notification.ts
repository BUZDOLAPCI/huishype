/**
 * Notification types for HuisHype
 *
 * Display copy is derived from eventType + payload at the client layer.
 * The API never returns pre-rendered notification text.
 */

export type NotificationEventType =
  | 'property_comment'
  | 'comment_reply'
  | 'comment_like'
  | 'property_like'
  | 'property_guess'
  | 'achievement_unlocked';

export interface NotificationActor {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
}

export interface NotificationItem {
  id: string;
  eventType: NotificationEventType;
  propertyId: string | null;
  commentId: string | null;
  guessId: string | null;
  reactionId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActor | null;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface UnreadCountResponse {
  count: number;
}
